# @adasouls/economic-core

The `EconomicAction` primitive: one agent's intent to do something
economic (pay, swap, hire…), carried through a fixed state machine with an
audit record for every change. In-memory and dependency-free — no
provider, no database, no policy logic.

```bash
npm install @adasouls/economic-core
```

## Usage

```ts
import { createEconomicAction, transition } from "@adasouls/economic-core";

const { action, audit } = createEconomicAction({
  principalId: "alma:main:organization:acme",
  agentId: "alma:main:agent:treasury",
  intent: { capability: "pay", amount: "500", asset: "USDC", to: "0x…" },
  capability: "pay",
  authority: { delegationId: "del_123", policySnapshot: [] },
  actor: { type: "agent", id: "alma:main:agent:treasury" },
});

const { action: authorized } = transition(action, "authorized", {
  actor: { type: "system", id: "my-api" },
});
```

Every call returns the new action **and** the audit record describing the
change; persisting both is the caller's job.

## State machine

| From | Legal next states |
|---|---|
| `created` | `rejected`, `pending_approval`, `authorized` |
| `pending_approval` | `authorized`, `rejected` |
| `authorized` | `executing` |
| `executing` | `confirmed`, `failed` |
| `confirmed` | `reversed` |
| `rejected`, `failed`, `reversed` | — (terminal) |

`transition` throws on anything else; `isLegalTransition(from, to)` checks
without throwing. An ambiguous provider outcome is not a state: the action
stays `executing` with `needsReconciliation` set until the provider's
ground truth is known.

## License

MIT
