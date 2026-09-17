# @adasouls/economic-core

## 0.1.2

### Patch Changes

- [`d3feb54`](https://github.com/AdaSouls/adasouls-engine/commit/d3feb547ea5c08cf9b90346fbcd48a6bec488a73) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Add EconomicAction.needsReconciliation, per
  docs/10-economic-action-lifecycle.md: an ambiguous provider outcome
  (submitted but not yet confirmed) is modeled as `executing` +
  this flag rather than a separate status, so it doesn't need its own
  transition table entry. Patchable via transition()'s existing `patch`
  option (no economic-core API change needed beyond the new field).
  Needed by Phase 6 (adasouls-worker)'s reconciliation logic.

## 0.1.1

### Patch Changes

- [`9c39aa7`](https://github.com/AdaSouls/adasouls-engine/commit/9c39aa785d8936098cfc0718315b614ffd7f1e00) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - First release to the private GitHub Packages registry (Phase 2):
  EconomicAction/EconomicIntent model and the full 9-transition state
  machine from docs/10-economic-action-lifecycle.md, in-memory only.
