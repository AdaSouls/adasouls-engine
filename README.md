# adasouls-engine

The economic orchestration engine behind [AdaSouls](https://github.com/AdaSouls):
it turns an AI agent's intent into a policy-checked, provider-routed,
auditable `EconomicAction`. Built on the [ALMA](https://github.com/AdaSouls/alma)
identity and trust protocol.

MIT licensed. Published to the public npm registry under `@adasouls`.

| Package | What it is |
|---|---|
| [`@adasouls/economic-core`](packages/economic-core) | The `EconomicAction` model: its state machine, legal transitions and audit records. |
| [`@adasouls/policy-engine`](packages/policy-engine) | Evaluates self / counterparty / market / execution policies against an intent: authorize, deny, or require approval. |
| [`@adasouls/provider-adapters`](packages/provider-adapters) | Provider-agnostic `AccountProvider` / `ChainAdapter` interfaces, a mock, and a Safe-on-Base-Sepolia implementation. |

```bash
npm install @adasouls/economic-core @adasouls/policy-engine @adasouls/provider-adapters
```

## Not a service

These are libraries. They have no network endpoint, no database and no
auth of their own. In AdaSouls they are used by the API (authorization:
identity → authority → policy → plan) and by the worker (execution:
provider call → confirmation → reconciliation).

## How an action flows

```text
created ──► rejected                     (a policy denied it)
   │
   ├──► pending_approval ──► authorized  (a human approved)
   │            └──────────► rejected
   │
   └──► authorized ──► executing ──► confirmed ──► reversed
                            └──────► failed
```

1. `economic-core` creates the action (`createEconomicAction`) and every
   status change goes through `transition`, which enforces the table above
   and emits an audit record.
2. `policy-engine` decides `created → authorized | pending_approval |
   rejected`. A hard deny always wins over a requested approval: a denied
   action is never approvable.
3. `provider-adapters` executes an authorized action and reports
   `confirmed`, `failed`, or an ambiguous outcome to reconcile later.

## Development

```bash
npm install
npm run lint
npm run build
npm test      # unit tests; no external services or credentials needed
```

Releases use [changesets](https://github.com/changesets/changesets): add a
changeset with your change (`npx changeset`); merging to `main` opens a
"Version Packages" PR, and merging that publishes to npm with provenance.

## Design references

Code comments cite AdaSouls design documents (`docs/NN-*.md`, `ADR-NNN`)
that are not published yet. The behavior they describe is summarized in
this README and in each package's README; the tests are the precise
specification.

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
