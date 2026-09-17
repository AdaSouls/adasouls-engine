---
"@adasouls/economic-core": patch
---

Add EconomicAction.needsReconciliation, per
docs/10-economic-action-lifecycle.md: an ambiguous provider outcome
(submitted but not yet confirmed) is modeled as `executing` +
this flag rather than a separate status, so it doesn't need its own
transition table entry. Patchable via transition()'s existing `patch`
option (no economic-core API change needed beyond the new field).
Needed by Phase 6 (adasouls-worker)'s reconciliation logic.
