/**
 * Test helper: executes a batch written by `npm run apply-limits` on a
 * 1-of-1 TESTNET Safe, signing as its owner. It sends the same
 * transactions Safe{Wallet}'s Transaction Builder would, as one
 * MultiSend, so the delegate path can be tested without a browser.
 *
 * Testnet only, on purpose: on a real Safe the owners review the batch
 * in Safe{Wallet} and sign there. `apply-limits` itself still takes no
 * key.
 *
 * Usage:
 *   TESTNET_SIGNER_PRIVATE_KEY=0x... npx tsx scripts/execute-batch-testnet.ts ./alma-limits.json
 */
import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { SafeKit } from "../src/kinds/safe-kit.js";
import { BASE_SEPOLIA_PUBLIC_RPC } from "../src/kinds/base-sepolia-chain.js";
import type { TransactionBuilderBatch } from "../src/apply-limits.js";

const BASE_SEPOLIA_CHAIN_ID = "84532";

const privateKey = process.env.TESTNET_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
const file = process.argv[2];
if (!privateKey || !file) {
  console.error("Set TESTNET_SIGNER_PRIVATE_KEY (the testnet Safe's owner) and pass the batch file.");
  process.exit(1);
}

const batch = JSON.parse(readFileSync(file, "utf-8")) as TransactionBuilderBatch;
if (batch.chainId !== BASE_SEPOLIA_CHAIN_ID) {
  console.error(`This helper only runs on Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}); the batch is for chain ${batch.chainId}.`);
  process.exit(1);
}

const safeAddress = batch.meta.createdFromSafeAddress;
const protocolKit = await SafeKit.init({ provider: BASE_SEPOLIA_PUBLIC_RPC, signer: privateKey, safeAddress });
const safeTransaction = await protocolKit.createTransaction({
  transactions: batch.transactions.map((t) => ({ to: t.to, value: t.value, data: t.data })),
});
const signed = await protocolKit.signTransaction(safeTransaction);
const { hash } = await protocolKit.executeTransaction(signed);
console.log(`Batch of ${batch.transactions.length} sent from ${safeAddress}: ${hash}`);

const client = createPublicClient({ transport: http(BASE_SEPOLIA_PUBLIC_RPC) });
const receipt = await client.waitForTransactionReceipt({ hash: hash as `0x${string}` });
console.log(`Mined in block ${receipt.blockNumber}: ${receipt.status}`);
if (receipt.status !== "success") process.exit(1);
