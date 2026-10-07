/**
 * One-time helper: deploys a fresh 1-of-1 Safe on Base Sepolia, owned by
 * the given private key, for testing SafeAccountProvider against a real
 * (but real-money-free) Safe.
 *
 * NOT run automatically by anything -- you run this yourself, once,
 * with your own testnet key. Needs that key funded with a little Base
 * Sepolia ETH first (for deployment gas) -- get some from a public
 * faucet (e.g. https://www.alchemy.com/faucets/base-sepolia), no
 * account/API-key needed for the faucet itself in most cases.
 *
 * Usage:
 *   TESTNET_SIGNER_PRIVATE_KEY=0x... npx tsx scripts/deploy-testnet-safe.ts
 */
import { SafeKit } from "../src/kinds/safe-kit.js";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_SEPOLIA_PUBLIC_RPC } from "../src/kinds/base-sepolia-chain.js";

const privateKey = process.env.TESTNET_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
if (!privateKey) {
  console.error("Set TESTNET_SIGNER_PRIVATE_KEY (a throwaway testnet key, 0x-prefixed) and rerun.");
  process.exit(1);
}

const owner = privateKeyToAccount(privateKey).address;
console.log(`Deploying a 1-of-1 Safe owned by ${owner} on Base Sepolia...`);

const protocolKit = await SafeKit.init({
  provider: BASE_SEPOLIA_PUBLIC_RPC,
  signer: privateKey,
  predictedSafe: {
    safeAccountConfig: { owners: [owner], threshold: 1 },
  },
});

const predictedAddress = await protocolKit.getAddress();
console.log(`Predicted Safe address: ${predictedAddress}`);

const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction();
// Run against Base Sepolia on 2026-10-07 (it deployed the test Safe).
const externalSigner = await protocolKit.getSafeProvider().getExternalSigner();
if (!externalSigner) {
  throw new Error("No external signer available from protocolKit.getSafeProvider() -- see the NOTE above.");
}
const sent: unknown = await externalSigner.sendTransaction({
  to: deploymentTransaction.to as `0x${string}`,
  value: BigInt(deploymentTransaction.value),
  data: deploymentTransaction.data as `0x${string}`,
});

// The signer answers with the hash or with a response object that has it, depending on the SDK version.
const txHash = typeof sent === "string" ? sent : (sent as { hash: string }).hash;
console.log(`Deployment tx sent: ${txHash}`);
console.log(`Once confirmed, your testnet Safe address is: ${predictedAddress}`);
console.log(`Set TESTNET_SAFE_ADDRESS=${predictedAddress} for the integration test.`);
