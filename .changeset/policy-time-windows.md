---
"@adasouls/policy-engine": minor
---

Security fix: an agent can no longer widen its organization's time window. Combining two `timeRestrictions` kept the narrower window instead of their intersection, so an organization's `[9, 17]` with an agent's `[0, 5]` allowed 03:00. Every window now applies (`timeRestrictions` may be a list), so windows that don't overlap allow no hour. Also: the end hour is excluded (`[9, 17]` ends at 16:59), a start after the end wraps past midnight (`[22, 6]`), the window is read in its `timezone` (UTC when omitted; it was ignored before), an unknown timezone or out-of-range hours deny, and without `now` in the context the current time is used instead of the rule being skipped.
