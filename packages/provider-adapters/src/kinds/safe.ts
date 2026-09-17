import Safe from "@safe-global/protocol-kit";
import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import type {
  AccountProvider,
  ExecutionResult,
  ProviderConnectionRef,
  SpendingLimitCheck,
  TransferRequest,
} from "../types.js";
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
 * 3. Independent limit enforcement: Safe's Allowance Module can enforce
 *    a real, on-chain spend limit per token/period, checked by the
 *    module contract itself, not trusted at AdaSouls's application
 *    layer. **Not wired up in this pass** -- checkSpendingLimit() below
 *    is an honest stub (always allowed) until a specific Allowance
 *    Module deployment/configuration exists to read against. Flagged
 *    as a real gap, not silently pretended complete -- see
 *    docs/MASTER-ROADMAP.md's Phase 5 status note.
 * 4. Failure semantics: execute() can throw before broadcast (rejected,
 *    e.g. insufficient signatures or a reverted simulation) or succeed
 *    with a txHash whose on-chain status is checked separately via
 *    getStatus() -- "submitted but not yet confirmed" is a real,
 *    distinct, non-error state (see BaseSepoliaChainAdapter's comment),
 *    not silently treated as success or failure.
 */

const USDC_DECIMALS = 6; // Hardcoded for this phase's exit criterion (a USDC transfer) -- a real
// multi-asset implementation needs a decimals lookup per asset
// (calling the token contract's own decimals(), or a static registry),
// not one constant. Flagged, not silently assumed for every asset.

export class SafeAccountProvider implements AccountProvider {
  constructor(private readonly rpcUrl: string = BASE_SEPOLIA_PUBLIC_RPC) {}

  async checkSpendingLimit(_connection: ProviderConnectionRef, _request: TransferRequest): Promise<SpendingLimitCheck> {
    // See the onboarding checklist above -- honest stub, not wired to
    // the Allowance Module yet.
    return { allowed: true };
  }

  async execute(connection: ProviderConnectionRef, request: TransferRequest): Promise<ExecutionResult> {
    const protocolKit = await Safe.init({
      provider: this.rpcUrl,
      signer: connection.signer.privateKey,
      safeAddress: connection.accountAddress,
    });

    const transaction =
      request.asset === "native"
        ? { to: request.to, value: parseUnits(request.amount, 18).toString(), data: "0x" }
        : {
            to: request.asset,
            value: "0",
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [request.to as `0x${string}`, parseUnits(request.amount, USDC_DECIMALS)],
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

    return { providerRef: txHash, status: "pending", txHash, ambiguous: true };
  }

  async getStatus(_connection: ProviderConnectionRef, providerRef: string): Promise<ExecutionResult> {
    const chain = new BaseSepoliaChainAdapter(this.rpcUrl);
    const status = await chain.getTransactionStatus(providerRef);
    return { providerRef, status, txHash: providerRef, ambiguous: status === "pending" };
  }
}
