# @adasouls/provider-adapters

## 0.1.1

### Patch Changes

- [`3d7083d`](https://github.com/AdaSouls/adasouls-engine/commit/3d7083d3350f185a05788cd80ef1f5c8fcf279d7) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - First release: AccountProvider/ChainAdapter interfaces (ADR-006), a
  MockAccountProvider for dependency-free contract testing, and a real
  SafeAccountProvider/BaseSepoliaChainAdapter implementation for Base
  Sepolia testnet. Phase 5's exit criterion (a simulated USDC transfer
  through the adapter interface) is demonstrated against the mock; real
  testnet verification needs a funded testnet Safe (see README.md).
