import { encodeFunctionData, getAddress, parseUnits } from "viem";
import { ALLOWANCE_MODULE_ABI, MAX_UINT96, SAFE_MODULE_ABI } from "./kinds/allowance-module.js";

/**
 * Turns an agent's declared limits into the Safe transactions that make
 * the chain enforce them: enable the Allowance Module (if it isn't),
 * make the agent's signer a delegate, and set one allowance per asset.
 *
 * It only compiles. Nothing here signs or sends: the output is a batch
 * the Safe's owners review and sign in Safe{Wallet}'s Transaction
 * Builder, because raising a limit must stay something only they can do.
 *
 * What the module can and can't hold, said in the output and not just
 * here:
 * - `dailySpend` becomes an allowance that resets every 1440 minutes.
 * - `maxTransaction` has no equivalent: the module has no per-transfer
 *   cap, so on chain the agent can move the whole daily allowance at
 *   once. That limit stays with the custody service (Ring 2), or needs
 *   the Zodiac Roles modifier.
 * - Approval thresholds and counterparty rules have no equivalent
 *   either: the module doesn't restrict who is paid.
 */
export interface ApplyLimitsInput {
  /** EIP-155 chain id, e.g. 84532. */
  chainId: number;
  safe: string;
  /** The agent's signer: the address that will be the delegate. Never one of the Safe's owners. */
  delegate: string;
  allowanceModule: string;
  /** Whether the module is already enabled on the Safe (read from the chain by the caller). */
  moduleEnabled: boolean;
  /** The declared limits, by asset symbol, as decimal amounts. The keys of alma.yaml's `authority`. */
  dailySpend?: Record<string, string>;
  maxTransaction?: Record<string, string>;
  humanApprovalThreshold?: Record<string, string>;
  /** Whether a counterparty policy is declared: only used to say that the chain doesn't enforce it. */
  hasCounterpartyPolicy?: boolean;
  /** Where each asset lives on this chain. */
  tokens: Record<string, { address: string; decimals: number }>;
  /** The Safe's owners, when known: the delegate must not be one of them. */
  owners?: string[];
  createdAt?: number;
}

export interface BuilderTransaction {
  to: string;
  value: "0";
  data: `0x${string}`;
  contractMethod: { name: string; payable: false; inputs: { internalType: string; name: string; type: string }[] };
  contractInputsValues: Record<string, string>;
}

/** The file Safe{Wallet}'s Transaction Builder imports. */
export interface TransactionBuilderBatch {
  version: "1.0";
  chainId: string;
  createdAt: number;
  meta: { name: string; description: string; createdFromSafeAddress: string };
  transactions: BuilderTransaction[];
}

export interface ApplyLimitsOutput {
  batch: TransactionBuilderBatch;
  /** One line per allowance that will be set. */
  allowances: { asset: string; token: string; amount: string; baseUnits: string; resetMinutes: number }[];
  /** What the chain will NOT enforce after this batch. Show these to whoever signs. */
  notes: string[];
}

const DAY_MINUTES = 1440;
const DECIMAL = /^\d+(\.\d+)?$/;

const inputs = (...pairs: [type: string, name: string][]) => pairs.map(([type, name]) => ({ internalType: type, name, type }));

export function compileLimits(input: ApplyLimitsInput): ApplyLimitsOutput {
  const safe = getAddress(input.safe);
  const delegate = getAddress(input.delegate);
  const module = getAddress(input.allowanceModule);
  if (delegate === safe) throw new Error("the delegate can't be the Safe itself");
  if (input.owners?.some((o) => getAddress(o) === delegate)) {
    throw new Error(`${delegate} is an owner of the Safe. An owner can move everything and raise any limit: the agent's signer must be a delegate only`);
  }

  const daily = Object.entries(input.dailySpend ?? {});
  if (daily.length === 0) throw new Error("no dailySpend limit is declared: there is nothing to turn into an allowance");

  const transactions: BuilderTransaction[] = [];
  if (!input.moduleEnabled) {
    transactions.push({
      to: safe,
      value: "0",
      data: encodeFunctionData({ abi: SAFE_MODULE_ABI, functionName: "enableModule", args: [module] }),
      contractMethod: { name: "enableModule", payable: false, inputs: inputs(["address", "module"]) },
      contractInputsValues: { module },
    });
  }
  transactions.push({
    to: module,
    value: "0",
    data: encodeFunctionData({ abi: ALLOWANCE_MODULE_ABI, functionName: "addDelegate", args: [delegate] }),
    contractMethod: { name: "addDelegate", payable: false, inputs: inputs(["address", "delegate"]) },
    contractInputsValues: { delegate },
  });

  const allowances: ApplyLimitsOutput["allowances"] = [];
  for (const [asset, amount] of daily) {
    const token = input.tokens[asset];
    if (!token) throw new Error(`no token address is known for ${asset} on chain ${input.chainId}: pass it explicitly`);
    if (!DECIMAL.test(amount)) throw new Error(`dailySpend.${asset} is "${amount}", which is not a decimal amount`);
    const fraction = amount.split(".")[1] ?? "";
    if (fraction.length > token.decimals) throw new Error(`dailySpend.${asset} is ${amount}, and ${asset} has only ${token.decimals} decimals`);
    const baseUnits = parseUnits(amount, token.decimals);
    if (baseUnits === 0n) throw new Error(`dailySpend.${asset} is zero: leave the asset out instead, and no allowance is set for it`);
    if (baseUnits > MAX_UINT96) throw new Error(`dailySpend.${asset} is larger than the module can hold`);
    const tokenAddress = getAddress(token.address);
    transactions.push({
      to: module,
      value: "0",
      // resetBaseMin 0: the first period starts when the transaction is mined.
      data: encodeFunctionData({ abi: ALLOWANCE_MODULE_ABI, functionName: "setAllowance", args: [delegate, tokenAddress, baseUnits, DAY_MINUTES, 0] }),
      contractMethod: { name: "setAllowance", payable: false, inputs: inputs(["address", "delegate"], ["address", "token"], ["uint96", "allowanceAmount"], ["uint16", "resetTimeMin"], ["uint32", "resetBaseMin"]) },
      contractInputsValues: { delegate, token: tokenAddress, allowanceAmount: baseUnits.toString(), resetTimeMin: String(DAY_MINUTES), resetBaseMin: "0" },
    });
    allowances.push({ asset, token: tokenAddress, amount, baseUnits: baseUnits.toString(), resetMinutes: DAY_MINUTES });
  }

  const notes: string[] = [];
  const perTx = Object.entries(input.maxTransaction ?? {});
  for (const [asset, max] of perTx) {
    const day = input.dailySpend?.[asset];
    if (day !== undefined) notes.push(`maxTransaction ${max} ${asset} is NOT enforced by the chain: the module has no per-transfer cap, so the agent's signer can move the whole ${day} ${asset} allowance in one transfer. That limit stays with the custody service (Ring 2); the Zodiac Roles modifier can enforce it on chain.`);
    else notes.push(`${asset} has a per-transaction limit and no daily limit: no allowance is set for it, so the chain allows the agent's signer none of it. Declare a dailySpend for ${asset} to allow it.`);
  }
  if (Object.keys(input.humanApprovalThreshold ?? {}).length) notes.push("The human-approval threshold is NOT enforced by the chain: within its allowance the agent's signer needs nobody's approval.");
  notes.push(input.hasCounterpartyPolicy ? "The counterparty policy is NOT enforced by the chain: the module doesn't restrict who is paid." : "The module doesn't restrict who is paid: within its allowance the agent's signer can pay any address.");
  notes.push("The daily period is 1440 minutes from when each allowance is set, not a calendar day.");
  notes.push("Only the Safe's owners can raise or remove these allowances. Size each one as what you accept losing in a day if everything above the chain fails.");

  return {
    batch: {
      version: "1.0",
      chainId: String(input.chainId),
      createdAt: input.createdAt ?? Date.now(),
      meta: { name: "ALMA limits", description: `Allowance Module limits for the agent signer ${delegate}, compiled from alma.yaml`, createdFromSafeAddress: safe },
      transactions,
    },
    allowances,
    notes,
  };
}
