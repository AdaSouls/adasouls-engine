# @adasouls/provider-adapters

`WalletProvider`/`AccountProvider`/`ChainAdapter`/... interfaces per
ADR-006, plus a mock (fully self-contained) and a real Safe-on-Base-Sepolia
implementation. Providers are the custody boundary: AdaSouls never holds keys; each
organization brings its own provider connection.

## What's implemented (Phase 5)

- `AccountProvider` + `ChainAdapter` interfaces (`src/types.ts`).
- `MockAccountProvider` / `MockChainAdapter` — in-memory, deterministic,
  what the default test suite runs against.
- `SafeAccountProvider` / `BaseSepoliaChainAdapter` — a real
  implementation, per `src/kinds/safe.ts`'s onboarding-checklist comment.
  A transfer takes one of two paths, depending on what the connection's
  signer is on chain:
  - a **delegate** of Safe's Allowance Module (and not an owner): it goes
    through `executeAllowanceTransfer`, and the module contract refuses
    anything over what is left of the allowance. This is the path an
    agent's connection should be on. `checkSpendingLimit()` reads the
    allowance and answers with `enforcedBy: "allowance-module"`.
  - an **owner** of the Safe: a normal Safe transaction, with no on-chain
    limit. `checkSpendingLimit()` says so rather than pretend one was
    checked.

  `ExecutionResult.path` records which one ran.
- `compileLimits()` and the `apply-limits` script (below): an agent's
  declared limits as the Safe transactions that set them on chain.

`npm test` runs only against the mock — no credentials needed. It's a
real dependency-free unit/contract test suite, safe to run anywhere,
including CI.

## Verifying against a real testnet Safe

This needs a throwaway testnet wallet you control — **not** an AdaSouls
credential, and not real money at any point. Every organization brings its
own provider connection; this only proves the adapter's plumbing works
against a real chain.

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
   Run against Base Sepolia on 2026-10-07.
4. Fund the resulting Safe address with a little testnet USDC (Circle's
   Base Sepolia faucet, or bridge/swap a small amount).
5. Run the real test:
   ```bash
   TESTNET_SIGNER_PRIVATE_KEY=0x... TESTNET_SAFE_ADDRESS=0x... npm run test:testnet
   ```

## Putting an agent's limits on chain

```bash
npm run apply-limits -- --manifest path/to/alma.yaml \
  --safe 0xSafe… --delegate 0xAgentSigner… --out alma-limits.json
```

Reads the Safe and the tokens (read-only calls), and writes a batch for
Safe{Wallet}'s Transaction Builder: enable the Allowance Module if it
isn't, add the agent's signer as a delegate, and set one allowance per
asset from `dailySpend`, resetting every 1440 minutes. It takes no key
and sends nothing: the Safe's owners review and sign the batch, since
raising a limit must stay something only they can do. It refuses to make
an owner the delegate.

It prints what the chain will **not** enforce afterwards. The module has
no per-transfer cap, so `maxTransaction` stays with the custody service
(the Zodiac Roles modifier could enforce it on chain); it doesn't
restrict who is paid; approval thresholds have no equivalent.

What has and hasn't been checked against Base Sepolia (2026-10-07):

- The module: there is no Base Sepolia entry in Safe's published
  deployment list for it. The address used
  (`0xAA46724893dedD72658219405185Fb0Fc91e091C`, v0.1.1) is the one
  listed for Base mainnet; on Base Sepolia it holds byte-identical code
  and answers `NAME()`, `VERSION()`, `getTokenAllowance`, `getDelegates`.
- The batch was executed on a 1-of-1 Safe
  (`0x4cA489903D7A13432ba9A0d3999E82dc43A1e86a`) with a 5 USDC daily
  limit, as one MultiSend signed by its owner
  (`scripts/execute-batch-testnet.ts`, a testnet-only helper): the
  module was enabled, the delegate added and the allowance set, as read
  back from the chain.
- The delegate then paid through `execute()`: 1 USDC went through the
  module; 5 USDC was refused before broadcast with 4 left of the
  allowance and 19 USDC in the Safe; the same 5 USDC broadcast without a
  simulation was mined as reverted and moved nothing; the remaining 4
  USDC went through, and 0.01 more was refused.
- **Not done:** importing the batch into Safe{Wallet}'s Transaction
  Builder (it was executed from code), a Safe with more than one owner,
  and the allowance's reset after 1440 minutes.

The delegate cases in `test/safe.testnet.test.ts` need
`TESTNET_DELEGATE_PRIVATE_KEY` (a delegate with an allowance left,
funded with a little ETH for its own gas).

`test:testnet` is a **separate** vitest config/script from `npm test` —
the default suite never touches the network, matching
`adasouls-worker/REPOSITORY.md`'s documented pattern for provider
adapter tests ("skipped by default in CI unless credentials are
present").

## Status

Phase 5 (`09-custody-and-key-management.md`'s onboarding checklist
documented in `src/kinds/safe.ts`): authorization model, revocation path,
and failure semantics are real and documented. Independent limit
enforcement (Safe's Allowance Module) is wired: reads are verified
against Base Sepolia, the delegate's transfer is not yet. Unit and
contract tests (against the mock, and of the allowance arithmetic and
the compiled batch) pass; the real testnet integration test is written
but not yet run against a Safe you own
— needs the setup above.
