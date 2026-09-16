---
"@adasouls/policy-engine": patch
---

First release: self/counterparty/market/execution policy evaluation per
docs/11-policy-model.md. evaluatePolicy() implements the fixed
self -> counterparty -> market -> execution order, fail-closed AND
combination of same-scope-level policies, agent-overrides-org per rule
key, and the explainable PolicyEvaluation result shape (allowed, reasons,
approvalsRequired, matchedPolicies). 21 tests, including conflicting-policy
and unconfigured-rule cases.
