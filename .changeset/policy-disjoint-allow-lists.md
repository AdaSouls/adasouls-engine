---
"@adasouls/policy-engine": minor
---

Security fix: two allow-lists with nothing in common now allow nothing. An organization `allowlist: ["A"]` combined with an agent's `["B"]` came out as `[]`, which was read as "no restriction", so any counterparty passed; the same held for `communityMembership`. An empty list, whether written or produced by combining, is now checked like any other and allows nobody. Only a list that is left out restricts nothing.
