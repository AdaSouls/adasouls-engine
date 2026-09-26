---
"@adasouls/policy-engine": patch
---

Security fix: a hard policy deny now discards approvals requested by earlier policy kinds. Previously, when a self policy required human approval and a later kind (e.g. counterparty) denied, `approvalsRequired` stayed non-empty, so callers routed the denied action to `pending_approval` and a human could approve it.
