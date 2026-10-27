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
- **A rule that exists is never skipped.** A rule left out (undefined)
  restricts nothing. A rule that is set is always checked: an allow-list
  that is empty, or that came out empty from combining two lists with
  nothing in common, allows nothing; and if the context lacks what a rule
  needs (an asset for `maxTransaction`, a chain for `allowedChains`, a
  `successRate` for `minSLA`, ...) the evaluation denies with a reason
  naming the missing field. (Since 0.3.0; earlier versions skipped those
  checks.)
- **Combining only narrows.** Lists intersect, limits take the tighter
  value, `maxPrice` keeps the lowest cap per asset, and time windows all
  apply. Once any `maxPrice` cap is set, a price in an asset with no cap is
  denied: prices are never converted.
- **Time windows** are `{ timezone?, allowedHours: [start, end] }`, read in
  `timezone` (UTC when omitted). The end hour is excluded (`[9, 17]` ends
  at 16:59), a start after the end wraps past midnight (`[22, 6]`), and
  `[0, 24]` is the whole day. Without `now` in the context the current
  time is used.
- **Trust your inputs.** The engine believes the context it's given. Values
  such as a counterparty's `completedTransactions` or `dailySpendSoFar`
  should be computed by your server, never taken from the acting agent.

## License

MIT
