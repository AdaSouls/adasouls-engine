# @adasouls/policy-engine

## 0.4.0

### Minor Changes

- [#12](https://github.com/AdaSouls/adasouls-engine/pull/12) [`f73aef5`](https://github.com/AdaSouls/adasouls-engine/commit/f73aef5a82041b1dd82526d704b975ae85f831da) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Counterparty policies can say whom the other side must act for. `allowedPrincipals` lets an agent transact only with counterparties acting for one of the listed organizations or people; `blockedPrincipals` denies those acting for any of them. Both compare against the new `CounterpartyContext.principalId` (an ALMA id), which the caller resolves. A counterparty with no known principal is denied by either rule, since neither can be checked without one. Across scopes they combine like `allowlist` and `blocklist`: allowed lists intersect, even to an empty list that allows nobody, and blocked lists add up.

## 0.3.0

### Minor Changes

- [#13](https://github.com/AdaSouls/adasouls-engine/pull/13) [`3e9dc32`](https://github.com/AdaSouls/adasouls-engine/commit/3e9dc32aa01c708f00ebd6801863224c1f8c5f89) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Security fix: two allow-lists with nothing in common now allow nothing. An organization `allowlist: ["A"]` combined with an agent's `["B"]` came out as `[]`, which was read as "no restriction", so any counterparty passed; the same held for `communityMembership`. An empty list, whether written or produced by combining, is now checked like any other and allows nobody. Only a list that is left out restricts nothing.

- [#13](https://github.com/AdaSouls/adasouls-engine/pull/13) [`3e9dc32`](https://github.com/AdaSouls/adasouls-engine/commit/3e9dc32aa01c708f00ebd6801863224c1f8c5f89) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Security fix: `maxPrice.perRequest` caps are now combined, keeping the lower cap per asset. Before, the first policy's cap won, so an agent's looser cap could replace the organization's, and a price in a different asset from the cap was never checked. `perRequest` may now be a list with one cap per asset; once any cap is set, a price in an asset without one is denied (no conversion). Prices are compared as exact decimals, and a cap with no price in the intent denies.

- [#13](https://github.com/AdaSouls/adasouls-engine/pull/13) [`3e9dc32`](https://github.com/AdaSouls/adasouls-engine/commit/3e9dc32aa01c708f00ebd6801863224c1f8c5f89) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Security fix: missing context for a rule that is set now denies, with a reason naming the field, instead of the rule being skipped. `maxTransaction`, `dailySpend` or `humanApprovalThreshold` with no `intent.asset` deny with "asset required" (or "amount required" without `intent.amount`); `allowedChains`, `allowedWalletProviders`, `allowedPaymentRails` and execution `allowedProtocols` deny when the intent leaves the field out, as do self `allowedAssets`/`allowedProtocols`/`allowedContracts`, market `allowedCurrencies` and `maxSlippage`; `minSLA` with no counterparty `successRate` denies with "not enough evidence"; a `blocklist` with no counterparty denies. Callers must now fill in every field a configured rule needs.

- [#13](https://github.com/AdaSouls/adasouls-engine/pull/13) [`3e9dc32`](https://github.com/AdaSouls/adasouls-engine/commit/3e9dc32aa01c708f00ebd6801863224c1f8c5f89) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Security fix: an agent can no longer widen its organization's time window. Combining two `timeRestrictions` kept the narrower window instead of their intersection, so an organization's `[9, 17]` with an agent's `[0, 5]` allowed 03:00. Every window now applies (`timeRestrictions` may be a list), so windows that don't overlap allow no hour. Also: the end hour is excluded (`[9, 17]` ends at 16:59), a start after the end wraps past midnight (`[22, 6]`), the window is read in its `timezone` (UTC when omitted; it was ignored before), an unknown timezone or out-of-range hours deny, and without `now` in the context the current time is used instead of the rule being skipped.

## 0.2.0

### Minor Changes

- [#10](https://github.com/AdaSouls/adasouls-engine/pull/10) [`63a9ca7`](https://github.com/AdaSouls/adasouls-engine/commit/63a9ca70af3d06d8e0d4d72793b433dfdde60200) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - An organization's rules are now a ceiling. An agent-scoped policy is combined with the organization's the same way two policies at one level are (the more restrictive value of each rule wins), so an agent's own policy can tighten a rule and can no longer loosen one. Before, an agent-scoped policy replaced the organization's value for the same rule key, which let it raise its own limit. If you relied on an agent policy to grant more than the organization default, raise the organization's rule instead.
  
  Amounts are compared exactly, as decimal strings, instead of through floating point: `0.1 + 0.2` no longer exceeds a `0.3` daily limit, and amounts that differ past the sixteenth digit are no longer equal. An amount, a limit, a price or a spent-so-far figure that isn't a plain non-negative decimal (`""`, `"-5"`, `"1e3"`, `"1,000"`) now denies with a reason, where it used to be read as a number (an empty amount as zero) or skipped. When two limits are combined and one can't be read, it is kept, so the evaluation denies instead of falling back to the other.

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
