# @adasouls/policy-engine

## 0.1.4

### Patch Changes

- [#7](https://github.com/AdaSouls/adasouls-engine/pull/7) [`2086795`](https://github.com/AdaSouls/adasouls-engine/commit/2086795bcb94a2d1ec591efc1465065d324541b0) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Open source under MIT and publish to the public npm registry instead of GitHub Packages.

## 0.1.3

### Patch Changes

- [#4](https://github.com/AdaSouls/adasouls-engine/pull/4) [`2a22baf`](https://github.com/AdaSouls/adasouls-engine/commit/2a22baf025fa4bfa229c89ee340f890bab9fe20e) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Security fix: a hard policy deny now discards approvals requested by earlier policy kinds. Previously, when a self policy required human approval and a later kind (e.g. counterparty) denied, `approvalsRequired` stayed non-empty, so callers routed the denied action to `pending_approval` and a human could approve it.

## 0.1.2

### Patch Changes

- [`9474320`](https://github.com/AdaSouls/adasouls-engine/commit/947432050c76299e7fc06e7ddc064645b8bab7bc) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Fix: PolicyEvaluation.allowed is now false when approval is required,
  not just on a hard deny. Previously a caller checking only `if (allowed)`
  would skip the approval gate entirely for a requires_approval outcome --
  a fail-open bug. allowed=true now means "authorize outright, nothing
  blocking"; false covers both a hard deny and needs-approval, distinguished
  by approvalsRequired.length, matching docs/06-api-contracts.md's dry-run
  example and the three-way created -> rejected | pending_approval |
  authorized state machine.

## 0.1.1

### Patch Changes

- [`f568430`](https://github.com/AdaSouls/adasouls-engine/commit/f568430b49a795c07286883010adb7f4112ccfe4) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - First release: self/counterparty/market/execution policy evaluation per
  docs/11-policy-model.md. evaluatePolicy() implements the fixed
  self -> counterparty -> market -> execution order, fail-closed AND
  combination of same-scope-level policies, agent-overrides-org per rule
  key, and the explainable PolicyEvaluation result shape (allowed, reasons,
  approvalsRequired, matchedPolicies). 21 tests, including conflicting-policy
  and unconfigured-rule cases.
