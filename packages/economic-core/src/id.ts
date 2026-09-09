import { randomBytes } from "node:crypto";

/** Crockford-ish, no ambiguous chars -- matches @adasouls/alma-core's randomLocalId convention. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export function randomId(prefix: string, length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}
