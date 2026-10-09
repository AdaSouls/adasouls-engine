# @adasouls/provider-adapters

## 0.2.0

### Minor Changes

- [#10](https://github.com/AdaSouls/adasouls-engine/pull/10) [`12bd58b`](https://github.com/AdaSouls/adasouls-engine/commit/12bd58b0898e034ca624dbdc6a7adc2f8e6ea01e) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Safe's Allowance Module is wired. `SafeAccountProvider.checkSpendingLimit()` reads the on-chain allowance of the connection's signer (it was a stub that always allowed) and says whether a contract enforces it (`enforcedBy`). `execute()` goes through the module's `executeAllowanceTransfer` when the signer is a delegate and not an owner, so the chain refuses anything over the allowance; `ExecutionResult.path` records which path ran. Token amounts use the token's own `decimals()` instead of a constant.
  
  New: `compileLimits()` and the `apply-limits` script turn an agent's declared limits into a Safe{Wallet} Transaction Builder batch (enable the module, add the delegate, one daily allowance per asset) for the Safe's owners to sign, and say what the chain will not enforce (the module has no per-transfer cap).
  
  Run against a real Safe on Base Sepolia: the batch was executed by the owner, a delegate's transfer within the allowance went through the module, and one over it was reverted by the contract. Not done: importing the batch into Safe{Wallet}'s Transaction Builder.

## 0.1.2

### Patch Changes

- [#7](https://github.com/AdaSouls/adasouls-engine/pull/7) [`2086795`](https://github.com/AdaSouls/adasouls-engine/commit/2086795bcb94a2d1ec591efc1465065d324541b0) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Open source under MIT and publish to the public npm registry instead of GitHub Packages.

## 0.1.1

### Patch Changes

- [`3d7083d`](https://github.com/AdaSouls/adasouls-engine/commit/3d7083d3350f185a05788cd80ef1f5c8fcf279d7) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - First release: AccountProvider/ChainAdapter interfaces (ADR-006), a
  MockAccountProvider for dependency-free contract testing, and a real
  SafeAccountProvider/BaseSepoliaChainAdapter implementation for Base
  Sepolia testnet. Phase 5's exit criterion (a simulated USDC transfer
  through the adapter interface) is demonstrated against the mock; real
  testnet verification needs a funded testnet Safe (see README.md).
