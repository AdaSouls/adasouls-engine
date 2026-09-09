# adasouls-engine

The economic orchestration engine behind AdaSouls: turns an agent's intent
into a policy-checked, provider-routed `EconomicAction`.

```text
packages/
  economic-core       EconomicAction model, state machine, execution planning
  policy-engine       self / counterparty / market / execution policy evaluation (Phase 4)
  provider-adapters   WalletProvider, ChainAdapter, PaymentProvider, ... interfaces + adapters (Phase 5)
```

## Not a service

This is a library, imported by `adasouls-api` (for authorization:
identity → authority → policy → plan) and `adasouls-worker` (for
execution: provider call → confirmation). It has no network endpoint, no
database, and no auth of its own.

## Development

```bash
npm install
npm test    # unit tests, no external services required
npm run build
```

## Status

Phase 2 (`economic-core`'s `EconomicAction` state machine) is done:
`createEconomicAction`/`transition`, the full 9-transition state machine
from `docs/10-economic-action-lifecycle.md`, and audit record emission —
in-memory only, no real provider yet, no dependency on policy-engine or
provider-adapters (those stay shape-only stubs on `EconomicAction` until
Phase 4/5). `policy-engine` and `provider-adapters` are scaffolded later,
at Phase 4 and Phase 5 respectively — see the roadmap in the `alma`
workspace's planning docs.
