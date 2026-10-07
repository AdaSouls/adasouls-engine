import Safe from "@safe-global/protocol-kit";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, formatUnits, getAddress, http, parseUnits, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type {
  AccountProvider,
  ExecutionResult,
  ProviderConnectionRef,
  SpendingLimitCheck,
  TransferRequest,
} from "../types.js";
import { ALLOWANCE_MODULE_ABI, ALLOWANCE_MODULE_BASE_SEPOLIA, MAX_UINT96, SAFE_MODULE_ABI, parseTokenAllowance, remainingAllowance } from "./allowance-module.js";
import { BASE_SEPOLIA_PUBLIC_RPC, BaseSepoliaChainAdapter } from "./base-sepolia-chain.js";

/**
 * Onboarding checklist per 09-custody-and-key-management.md -- documented
 * here, not just implemented, since the doc requires this to be written
 * down per adapter:
 *
 * 1. Authorization model: Safe's own on-chain multisig threshold logic.
 *    AdaSouls requests a signature/execution; Safe's contract
 *    independently verifies the signature(s) meet the configured
 *    threshold before allowing execution -- AdaSouls being wrong or
 *    compromised is not sufficient alone to move funds, per
 *    08-security-model.md.
 * 2. Revocation: the Safe owner(s) can swap/remove signers on the Safe
 *    contract directly (via the Safe{Wallet} app or any Safe-compatible
 *    tool), independent of AdaSouls -- this immediately and
 *    unilaterally cuts off whatever signer AdaSouls was using, with no
 *    AdaSouls cooperation required or possible to block.
 * 3. Independent limit enforcement: Safe's Allowance Module holds an
 *    on-chain allowance per delegate and token, with a reset period,
 *    checked by the module contract itself. Which of two paths a
 *    transfer takes depends on what the connection's signer is ON CHAIN:
 *    - a delegate of the module (and not an owner): the transfer goes
 *      through executeAllowanceTransfer, and the contract refuses
 *      anything over what is left of the allowance. This is the path an
 *      agent's connection should be on.
 *    - an owner of the Safe: the transfer is a normal Safe transaction,
 *      and NO on-chain limit applies. checkSpendingLimit() says so
 *      (no `enforcedBy`) instead of pretending a limit was checked.
 *    Reads are verified against the module on Base Sepolia (see
 *    allowance-module.ts). The delegate path's transaction has not been
 *    run against a real Safe yet: test/safe.testnet.test.ts has the
 *    case, and it needs a funded Safe with an allowance set.
 * 4. Failure semantics: execute() can throw before broadcast (rejected,
 *    e.g. insufficient signatures or a reverted simulation) or succeed
 *    with a txHash whose on-chain status is checked separately via
 *    getStatus() -- "submitted but not yet confirmed" is a real,
 *    distinct, non-error state (see BaseSepoliaChainAdapter's comment),
 *    not silently treated as success or failure.
 */

const NATIVE_DECIMALS = 18;

export interface SafeAccountProviderOptions {
  /** The Allowance Module's address on this chain. Defaults to the one verified on Base Sepolia. */
  allowanceModule?: `0x${string}`;
  /** Injectable clock (seconds), for the allowance's reset period. */
  now?: () => number;
}

// Type left to inference, for the reason given in base-sepolia-chain.ts.
function createClient(rpcUrl: string) {
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

export class SafeAccountProvider implements AccountProvider {
  private readonly client: ReturnType<typeof createClient>;
  private readonly allowanceModule: `0x${string}`;
  private readonly now: () => number;

  constructor(
    private readonly rpcUrl: string = BASE_SEPOLIA_PUBLIC_RPC,
    options: SafeAccountProviderOptions = {}
  ) {
    this.client = createClient(rpcUrl);
    this.allowanceModule = getAddress(options.allowanceModule ?? ALLOWANCE_MODULE_BASE_SEPOLIA);
    this.now = options.now ?? (() => Date.now() / 1000);
  }

  /** The token's own decimals(), read from its contract: never assumed from one asset. */
  private async decimals(asset: string): Promise<number> {
    if (asset === "native") return NATIVE_DECIMALS;
    return this.client.readContract({ address: getAddress(asset), abi: erc20Abi, functionName: "decimals" });
  }

  /** What the connection's signer is on chain: an owner of the Safe, or (at most) a delegate of the module. */
  private async signerRole(connection: ProviderConnectionRef): Promise<{ signer: `0x${string}`; safe: `0x${string}`; isOwner: boolean; moduleEnabled: boolean }> {
    const signer = privateKeyToAccount(connection.signer.privateKey).address;
    const safe = getAddress(connection.accountAddress);
    const [owners, moduleEnabled] = await Promise.all([
      this.client.readContract({ address: safe, abi: SAFE_MODULE_ABI, functionName: "getOwners" }),
      this.client.readContract({ address: safe, abi: SAFE_MODULE_ABI, functionName: "isModuleEnabled", args: [this.allowanceModule] }),
    ]);
    return { signer, safe, isOwner: owners.some((o) => getAddress(o) === signer), moduleEnabled };
  }

  async checkSpendingLimit(connection: ProviderConnectionRef, request: TransferRequest): Promise<SpendingLimitCheck> {
    const role = await this.signerRole(connection);
    if (role.isOwner) {
      // True, and not reassuring: nothing on chain caps an owner.
      return { allowed: true, reason: "the signer is an owner of the Safe: no on-chain limit applies to it" };
    }
    if (!role.moduleEnabled) {
      return { allowed: false, reason: "the signer is not an owner of the Safe and the Allowance Module is not enabled on it: it can move nothing" };
    }

    const token = request.asset === "native" ? zeroAddress : getAddress(request.asset);
    const decimals = await this.decimals(request.asset);
    const allowance = parseTokenAllowance(
      await this.client.readContract({ address: this.allowanceModule, abi: ALLOWANCE_MODULE_ABI, functionName: "getTokenAllowance", args: [role.safe, role.signer, token] })
    );
    const remaining = remainingAllowance(allowance, this.now());
    const amount = parseUnits(request.amount, decimals);
    const left = formatUnits(remaining, decimals);
    if (allowance.nonce === 0) {
      return { allowed: false, reason: "no allowance is set for this signer and asset in the Allowance Module", remaining: "0", enforcedBy: "allowance-module" };
    }
    if (amount > remaining) {
      return { allowed: false, reason: `amount ${request.amount} exceeds the ${left} left of the on-chain allowance`, remaining: left, enforcedBy: "allowance-module" };
    }
    return { allowed: true, remaining: left, enforcedBy: "allowance-module" };
  }

  async execute(connection: ProviderConnectionRef, request: TransferRequest): Promise<ExecutionResult> {
    const role = await this.signerRole(connection);
    const decimals = await this.decimals(request.asset);
    const amount = parseUnits(request.amount, decimals);

    if (!role.isOwner) {
      // The signer is a delegate (or nothing): the only way out of the
      // Safe is the module, which checks the allowance itself. Sent by
      // the delegate with an empty signature, which the module reads as
      // "the caller is the delegate". Gas is paid by the delegate's own
      // address, never out of the Safe (paymentToken/payment are zero).
      if (amount > MAX_UINT96) throw new Error("amount is larger than the Allowance Module can transfer");
      const account = privateKeyToAccount(connection.signer.privateKey);
      const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(this.rpcUrl) });
      // writeContract simulates first: over the allowance, it throws here and nothing is broadcast.
      const txHash = await wallet.writeContract({
        address: this.allowanceModule,
        abi: ALLOWANCE_MODULE_ABI,
        functionName: "executeAllowanceTransfer",
        args: [role.safe, request.asset === "native" ? zeroAddress : getAddress(request.asset), getAddress(request.to), amount, zeroAddress, 0n, account.address, "0x"],
      });
      return { providerRef: txHash, status: "pending", txHash, ambiguous: true, path: "allowance-module" };
    }

    const protocolKit = await Safe.init({
      provider: this.rpcUrl,
      signer: connection.signer.privateKey,
      safeAddress: connection.accountAddress,
    });

    const transaction =
      request.asset === "native"
        ? { to: request.to, value: amount.toString(), data: "0x" }
        : {
            to: request.asset,
            value: "0",
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [request.to as `0x${string}`, amount],
            }),
          };

    const safeTransaction = await protocolKit.createTransaction({ transactions: [transaction] });
    const signed = await protocolKit.signTransaction(safeTransaction);

    // Threshold-1 Safes execute directly once signed; a threshold > 1
    // Safe needs proposeTransaction()/confirmTransaction() via
    // @safe-global/api-kit's Transaction Service instead -- out of scope
    // for this first pass (Phase 5's exit criterion is one simulated
    // transfer, not multisig collection UX), flagged rather than
    // silently assumed.
    const executeResponse = await protocolKit.executeTransaction(signed);
    const txHash = executeResponse.hash;

    return { providerRef: txHash, status: "pending", txHash, ambiguous: true, path: "owner" };
  }

  async getStatus(_connection: ProviderConnectionRef, providerRef: string): Promise<ExecutionResult> {
    const chain = new BaseSepoliaChainAdapter(this.rpcUrl);
    const status = await chain.getTransactionStatus(providerRef);
    return { providerRef, status, txHash: providerRef, ambiguous: status === "pending" };
  }
}
