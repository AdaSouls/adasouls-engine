/**
 * Mirrors @adasouls/alma-core's AlmaValidationError shape ("fail loudly,
 * name the field") -- economic-core doesn't depend on alma-core yet (no
 * GitHub Packages read access configured for this repo's CI/local dev as
 * of 2026-09-09, see docs/MASTER-ROADMAP.md), so this is a small local
 * copy of the same convention rather than a shared import.
 */
export class EconomicCoreError extends Error {
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string) {
    super(`${field}: ${reason}`);
    this.name = "EconomicCoreError";
    this.field = field;
    this.reason = reason;
  }
}
