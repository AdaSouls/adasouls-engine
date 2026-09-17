# @adasouls/provider-adapters

`WalletProvider`/`AccountProvider`/`ChainAdapter`/... interfaces per
ADR-006, plus a mock (fully self-contained) and a real Safe-on-Base-Sepolia
implementation. See `docs/09-custody-and-key-management.md` for the
provider category table and onboarding requirements.

## What's implemented (Phase 5)

- `AccountProvider` + `ChainAdapter` interfaces (`src/types.ts`).
- `MockAccountProvider` / `MockChainAdapter` — in-memory, deterministic,
  what the default test suite runs against.
- `SafeAccountProvider` / `BaseSepoliaChainAdapter` — a real
  implementation, per `src/kinds/safe.ts`'s onboarding-checklist comment.
  `checkSpendingLimit()` is an honest stub (always `allowed: true`) —
  Safe's Allowance Module isn't wired up yet, flagged, not pretended.

`npm test` runs only against the mock — no credentials needed. It's a
real dependency-free unit/contract test suite, safe to run anywhere,
including CI.

## Verifying against a real testnet Safe

This needs a throwaway testnet wallet you control — **not** an AdaSouls
credential, and not real money at any point. Per the multi-tenant model
(every organization brings its own provider connection — see
`05-data-ownership.md`'s `ProviderConnection`), this is just proving the
adapter's plumbing actually works against a real chain.

1. Generate a throwaway private key (anything works, e.g.
   `npx viem generatePrivateKey` or any wallet tool) — **never reuse a
   key that holds anything real.**
2. Fund it with a little Base Sepolia ETH (for gas) from a public faucet,
   e.g. <https://www.alchemy.com/faucets/base-sepolia> — no account
   needed for most faucets.
3. Deploy a 1-of-1 Safe you own:
   ```bash
   TESTNET_SIGNER_PRIVATE_KEY=0x... npm run deploy:testnet-safe
   ```
   This script is **unverified by me** — I have no funded testnet key to
   run it end to end myself. If it errors, paste me the exact error and
   we'll fix it together, same as the Terraform/RDS debugging earlier.
4. Fund the resulting Safe address with a little testnet USDC (Circle's
   Base Sepolia faucet, or bridge/swap a small amount).
5. Run the real test:
   ```bash
   TESTNET_SIGNER_PRIVATE_KEY=0x... TESTNET_SAFE_ADDRESS=0x... npm run test:testnet
   ```

`test:testnet` is a **separate** vitest config/script from `npm test` —
the default suite never touches the network, matching
`adasouls-worker/REPOSITORY.md`'s documented pattern for provider
adapter tests ("skipped by default in CI unless credentials are
present").

## Status

Phase 5 (`09-custody-and-key-management.md`'s onboarding checklist
documented in `src/kinds/safe.ts`): authorization model, revocation path,
and failure semantics are real and documented. Independent limit
enforcement (Safe's Allowance Module) is a known, flagged gap, not wired
up in this pass. Contract tests (8, against the mock) pass; the real
testnet integration test is written but not yet run against a real Safe
— needs the setup above.
