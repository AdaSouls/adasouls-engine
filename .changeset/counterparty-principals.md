---
"@adasouls/policy-engine": minor
---

Counterparty policies can say whom the other side must act for. `allowedPrincipals` lets an agent transact only with counterparties acting for one of the listed organizations or people; `blockedPrincipals` denies those acting for any of them. Both compare against the new `CounterpartyContext.principalId` (an ALMA id), which the caller resolves. A counterparty with no known principal is denied by either rule, since neither can be checked without one. Across scopes they combine like `allowlist` and `blocklist`: allowed lists intersect, even to an empty list that allows nobody, and blocked lists add up.
