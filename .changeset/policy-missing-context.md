---
"@adasouls/policy-engine": minor
---

Security fix: missing context for a rule that is set now denies, with a reason naming the field, instead of the rule being skipped. `maxTransaction`, `dailySpend` or `humanApprovalThreshold` with no `intent.asset` deny with "asset required" (or "amount required" without `intent.amount`); `allowedChains`, `allowedWalletProviders`, `allowedPaymentRails` and execution `allowedProtocols` deny when the intent leaves the field out, as do self `allowedAssets`/`allowedProtocols`/`allowedContracts`, market `allowedCurrencies` and `maxSlippage`; `minSLA` with no counterparty `successRate` denies with "not enough evidence"; a `blocklist` with no counterparty denies. Callers must now fill in every field a configured rule needs.
