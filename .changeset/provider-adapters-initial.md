---
"@adasouls/provider-adapters": patch
---

First release: AccountProvider/ChainAdapter interfaces (ADR-006), a
MockAccountProvider for dependency-free contract testing, and a real
SafeAccountProvider/BaseSepoliaChainAdapter implementation for Base
Sepolia testnet. Phase 5's exit criterion (a simulated USDC transfer
through the adapter interface) is demonstrated against the mock; real
testnet verification needs a funded testnet Safe (see README.md).
