---
"@adasouls/policy-engine": minor
---

An organization's rules are now a ceiling. An agent-scoped policy is combined with the organization's the same way two policies at one level are (the more restrictive value of each rule wins), so an agent's own policy can tighten a rule and can no longer loosen one. Before, an agent-scoped policy replaced the organization's value for the same rule key, which let it raise its own limit. If you relied on an agent policy to grant more than the organization default, raise the organization's rule instead.

Amounts are compared exactly, as decimal strings, instead of through floating point: `0.1 + 0.2` no longer exceeds a `0.3` daily limit, and amounts that differ past the sixteenth digit are no longer equal. An amount, a limit, a price or a spent-so-far figure that isn't a plain non-negative decimal (`""`, `"-5"`, `"1e3"`, `"1,000"`) now denies with a reason, where it used to be read as a number (an empty amount as zero) or skipped. When two limits are combined and one can't be read, it is kept, so the evaluation denies instead of falling back to the other.
