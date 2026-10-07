/**
 * Amounts are decimal strings ("12.50"), compared exactly. Never through
 * Number(): that rounds past 15 digits, adds 0.1 and 0.2 to something
 * other than 0.3, and reads "" as 0 and "1e3" as 1000 -- each one a way
 * for a limit to mean something other than what was written.
 */
const DECIMAL = /^\d+(\.\d+)?$/;

/** A non-negative decimal amount, digits only. */
export function isAmount(v: unknown): v is string {
  return typeof v === "string" && DECIMAL.test(v);
}

function scaled(a: string, b: string): [bigint, bigint, number] {
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  return [BigInt(ai + af.padEnd(scale, "0")), BigInt(bi + bf.padEnd(scale, "0")), scale];
}

/** -1, 0 or 1. Both must be amounts (see isAmount). */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = scaled(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The exact sum, without trailing zeros. Both must be amounts. */
export function addAmounts(a: string, b: string): string {
  const [x, y, scale] = scaled(a, b);
  const digits = (x + y).toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -scale)}.${fraction}` : digits.slice(0, -scale);
}
