---
"@adasouls/policy-engine": minor
---

Security fix: `maxPrice.perRequest` caps are now combined, keeping the lower cap per asset. Before, the first policy's cap won, so an agent's looser cap could replace the organization's, and a price in a different asset from the cap was never checked. `perRequest` may now be a list with one cap per asset; once any cap is set, a price in an asset without one is denied (no conversion). Prices are compared as exact decimals, and a cap with no price in the intent denies.
