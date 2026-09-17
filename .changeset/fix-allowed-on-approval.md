---
"@adasouls/policy-engine": patch
---

Fix: PolicyEvaluation.allowed is now false when approval is required,
not just on a hard deny. Previously a caller checking only `if (allowed)`
would skip the approval gate entirely for a requires_approval outcome --
a fail-open bug. allowed=true now means "authorize outright, nothing
blocking"; false covers both a hard deny and needs-approval, distinguished
by approvalsRequired.length, matching docs/06-api-contracts.md's dry-run
example and the three-way created -> rejected | pending_approval |
authorized state machine.
