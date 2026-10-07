---
"@adasouls/provider-adapters": minor
---

Safe's Allowance Module is wired. `SafeAccountProvider.checkSpendingLimit()` reads the on-chain allowance of the connection's signer (it was a stub that always allowed) and says whether a contract enforces it (`enforcedBy`). `execute()` goes through the module's `executeAllowanceTransfer` when the signer is a delegate and not an owner, so the chain refuses anything over the allowance; `ExecutionResult.path` records which path ran. Token amounts use the token's own `decimals()` instead of a constant.

New: `compileLimits()` and the `apply-limits` script turn an agent's declared limits into a Safe{Wallet} Transaction Builder batch (enable the module, add the delegate, one daily allowance per asset) for the Safe's owners to sign, and say what the chain will not enforce (the module has no per-transfer cap).

Reads are verified against Base Sepolia. The delegate's transfer and the batch's execution have not been run against a real Safe yet.
