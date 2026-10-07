import { parseAbi } from "viem";

/**
 * Safe's Allowance Module: a per-delegate, per-token allowance with an
 * optional reset period, enforced by the module contract. A delegate
 * moves funds out of the Safe on its own signature, up to what is left
 * of its allowance, and the contract refuses anything above it -- which
 * is the one limit here that holds even when AdaSouls is wrong or
 * compromised.
 *
 * Function names and argument order below are those of the module's
 * published ABI (@safe-global/safe-modules-deployments 3.0.10,
 * allowance-module v0.1.1) and of its source
 * (safe-global/safe-modules, modules/allowances/contracts/AllowanceModule.sol).
 */
export const ALLOWANCE_MODULE_ABI = parseAbi([
  "function getTokenAllowance(address safe, address delegate, address token) view returns (uint256[5])",
  "function getDelegates(address safe, uint48 start, uint8 pageSize) view returns (address[] results, uint48 next)",
  "function addDelegate(address delegate)",
  "function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)",
  "function executeAllowanceTransfer(address safe, address token, address to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes signature)",
]);

export const SAFE_MODULE_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function isModuleEnabled(address module) view returns (bool)",
  "function enableModule(address module)",
]);

/**
 * Allowance Module v0.1.1 on Base Sepolia (chain 84532).
 *
 * Safe's published deployment list does not include Base Sepolia for
 * this module. This address is the one it lists for Base mainnet (and
 * 52 other chains: the module is deployed at one deterministic address).
 * Checked on 2026-10-07 against https://sepolia.base.org: there is code
 * at it, byte-identical to Base mainnet's (keccak256
 * 0x7aa63affdca06fe94576f00077ad61a02ccf203a5da31e1b4ed595df7b65cf3e),
 * NAME() is "Allowance Module", VERSION() is "0.1.1", and
 * getTokenAllowance / getDelegates / generateTransferHash answer.
 * The state-changing functions (enableModule, addDelegate, setAllowance,
 * executeAllowanceTransfer) were run from this code against a real Safe
 * on Base Sepolia the same day: see the README.
 */
export const ALLOWANCE_MODULE_BASE_SEPOLIA = "0xAA46724893dedD72658219405185Fb0Fc91e091C" as const;

/** The largest amount the module can hold: its amounts are uint96. */
export const MAX_UINT96 = (1n << 96n) - 1n;

export interface TokenAllowance {
  /** In the token's base units. */
  amount: bigint;
  spent: bigint;
  /** Minutes after which `spent` returns to zero. 0: it never does (a one-time allowance). */
  resetTimeMin: number;
  /** The minute (unix time / 60) the current period started. */
  lastResetMin: number;
  /** 0 until an allowance has been set for this delegate and token. */
  nonce: number;
}

/** getTokenAllowance()'s five numbers, named. */
export function parseTokenAllowance(raw: readonly bigint[]): TokenAllowance {
  if (raw.length !== 5) throw new Error("getTokenAllowance did not return five values");
  return { amount: raw[0], spent: raw[1], resetTimeMin: Number(raw[2]), lastResetMin: Number(raw[3]), nonce: Number(raw[4]) };
}

/**
 * What the delegate can still move right now. getTokenAllowance returns
 * the stored `spent`, which the contract only zeroes when the next
 * transfer runs, so the reset is applied here the way the contract's own
 * getAllowance() does: once a full period has passed since lastResetMin.
 */
export function remainingAllowance(allowance: TokenAllowance, nowSeconds: number): bigint {
  const currentMin = Math.floor(nowSeconds / 60);
  const periodOver = allowance.resetTimeMin > 0 && allowance.lastResetMin <= currentMin - allowance.resetTimeMin;
  const spent = periodOver ? 0n : allowance.spent;
  return allowance.amount > spent ? allowance.amount - spent : 0n;
}
