# @adasouls/policy-engine

Evaluates an agent's intent against the policies that apply to it and
answers: authorize, deny, or require approval. Pure and synchronous — the
caller resolves which policies apply and supplies the context.

```bash
npm install @adasouls/policy-engine
```

## Usage

```ts
import { evaluatePolicy } from "@adasouls/policy-engine";

const result = evaluatePolicy(policies, {
  agentId: "alma:main:agent:treasury",
  intent: { capability: "pay", amount: "750", asset: "USDC" },
  counterparty: { id: "alma:main:agent:vendor", completedTransactions: 3 },
  dailySpendSoFar: { USDC: "200" },
});

if (result.allowed) {
  // authorize
} else if (result.approvalsRequired.length > 0) {
  // wait for a human
} else {
  // deny -- result.reasons says why
}
```

`allowed` alone is not "go ahead": `false` covers both a deny and a
needs-approval outcome, told apart by `approvalsRequired`.

## Policy kinds

Evaluated in a fixed order: **self → counterparty → market → execution**.

| Kind | Examples of rules |
|---|---|
| `self` | `maxTransaction`, `dailySpend`, `allowedAssets`, `allowedActions`, `timeRestrictions`, `humanApprovalThreshold` |
| `counterparty` | `minCompletedTransactions`, `minReputationEvidence`, `organizationVerification`, `requiredCredentials`, `allowlist`, `blocklist` |
| `market` | `maxPrice`, `maxSlippage`, `minSLA`, `allowedCurrencies` |
| `execution` | `allowedChains`, `allowedWalletProviders`, `allowedPaymentRails`, `allowedProtocols` |

When several policies of one kind apply (an organization default plus an
agent's own), the more restrictive rule wins.

## Semantics that matter

- **The first deny stops evaluation.** Later kinds are not evaluated.
- **Approvals don't stop evaluation**, so the caller sees every approval
  needed.
- **A deny wins over approvals.** If an earlier kind asked for approval and
  a later kind denies, `approvalsRequired` is emptied: a denied action is
  never approvable. (Fixed in 0.1.3; earlier versions left the approvals
  in place.)
- **Trust your inputs.** The engine believes the context it's given. Values
  such as a counterparty's `completedTransactions` or `dailySpendSoFar`
  should be computed by your server, never taken from the acting agent.

## License

MIT
