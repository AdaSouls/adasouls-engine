# @adasouls/policy-engine

## 0.1.1

### Patch Changes

- [`f568430`](https://github.com/AdaSouls/adasouls-engine/commit/f568430b49a795c07286883010adb7f4112ccfe4) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - First release: self/counterparty/market/execution policy evaluation per
  docs/11-policy-model.md. evaluatePolicy() implements the fixed
  self -> counterparty -> market -> execution order, fail-closed AND
  combination of same-scope-level policies, agent-overrides-org per rule
  key, and the explainable PolicyEvaluation result shape (allowed, reasons,
  approvalsRequired, matchedPolicies). 21 tests, including conflicting-policy
  and unconfigured-rule cases.
