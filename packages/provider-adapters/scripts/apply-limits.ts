/**
 * Compiles an agent's alma.yaml into the Safe transactions that make the
 * chain enforce its limits (the "Lock" level): enable the Allowance
 * Module if needed, add the agent's signer as a delegate, set one daily
 * allowance per asset.
 *
 * It signs and sends NOTHING, and takes no key. It reads the Safe (its
 * owners, whether the module is enabled) and each token's decimals, and
 * writes a file the Safe's owners import in Safe{Wallet} > Apps >
 * Transaction Builder, review, and sign.
 *
 * Usage:
 *   npm run apply-limits -- --safe 0xSafe… --delegate 0xAgentSigner… \
 *     [--manifest ./alma.yaml] [--out ./alma-limits.json] \
 *     [--rpc https://sepolia.base.org] [--module 0x…] [--token DAI=0x…]
 *
 * The batch's transactions were executed on a real Safe on Base Sepolia
 * (from code, see scripts/execute-batch-testnet.ts) and did what they
 * say. NOT YET VERIFIED: importing the file into Safe{Wallet}. Check
 * what the Transaction Builder shows before signing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { parseManifestYaml } from "@adasouls/alma-manifest";
import { compileLimits } from "../src/apply-limits.js";
import { ALLOWANCE_MODULE_BASE_SEPOLIA, SAFE_MODULE_ABI } from "../src/kinds/allowance-module.js";
import { BASE_SEPOLIA_PUBLIC_RPC } from "../src/kinds/base-sepolia-chain.js";

/** Token addresses this script knows without being told, per chain id. Anything else: --token SYMBOL=0x… */
const KNOWN_TOKENS: Record<number, Record<string, string>> = {
  84532: { USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
};
/** Where the Allowance Module is, per chain id, when that has been checked (see allowance-module.ts). Anything else: --module 0x… */
const KNOWN_MODULES: Record<number, string> = { 84532: ALLOWANCE_MODULE_BASE_SEPOLIA };

const { values } = parseArgs({
  options: {
    manifest: { type: "string", default: "./alma.yaml" },
    safe: { type: "string" },
    delegate: { type: "string" },
    module: { type: "string" },
    rpc: { type: "string", default: BASE_SEPOLIA_PUBLIC_RPC },
    token: { type: "string", multiple: true, default: [] },
    out: { type: "string", default: "./alma-limits.json" },
  },
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!values.safe || !values.delegate) fail("--safe (the Safe's address) and --delegate (the agent signer's address) are required");

const manifest = parseManifestYaml(readFileSync(values.manifest!, "utf-8"));
const authority = manifest.authority ?? {};

const client = createPublicClient({ transport: http(values.rpc) });
const chainId = await client.getChainId();
const safe = getAddress(values.safe);
const moduleAddress = values.module ?? KNOWN_MODULES[chainId] ?? fail(`no Allowance Module address is known for chain ${chainId}: pass --module`);
const module = getAddress(moduleAddress);
if (((await client.getCode({ address: module })) ?? "0x") === "0x") fail(`there is no contract at ${module} on chain ${chainId}`);

const [owners, moduleEnabled] = await Promise.all([
  client.readContract({ address: safe, abi: SAFE_MODULE_ABI, functionName: "getOwners" }),
  client.readContract({ address: safe, abi: SAFE_MODULE_ABI, functionName: "isModuleEnabled", args: [module] }),
]).catch(() => fail(`${safe} doesn't answer as a Safe on chain ${chainId}`));

const addresses: Record<string, string> = { ...KNOWN_TOKENS[chainId] };
for (const pair of values.token!) {
  const [symbol, address] = pair.split("=");
  if (!symbol || !address) fail(`--token: write it as SYMBOL=0x…, got "${pair}"`);
  addresses[symbol.toUpperCase()] = address;
}
const tokens: Record<string, { address: string; decimals: number }> = {};
for (const symbol of Object.keys(authority.dailySpend ?? {})) {
  const address = addresses[symbol];
  if (!address) continue; // compileLimits names the missing asset.
  // The token's own decimals(), never assumed.
  tokens[symbol] = { address, decimals: await client.readContract({ address: getAddress(address), abi: erc20Abi, functionName: "decimals" }) };
}

let output: ReturnType<typeof compileLimits>;
try {
  output = compileLimits({
    chainId,
    safe,
    delegate: values.delegate,
    allowanceModule: module,
    moduleEnabled,
    owners: [...owners],
    dailySpend: authority.dailySpend,
    maxTransaction: authority.maxTransaction,
    humanApprovalThreshold: authority.humanApprovalThreshold,
    hasCounterpartyPolicy: Boolean(manifest.counterpartyPolicy && Object.keys(manifest.counterpartyPolicy).length),
    tokens,
  });
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

writeFileSync(values.out!, JSON.stringify(output.batch, null, 2) + "\n", "utf-8");

console.log(`Safe ${safe} on chain ${chainId} (${owners.length} owner${owners.length === 1 ? "" : "s"}), Allowance Module ${module} ${moduleEnabled ? "already enabled" : "not enabled yet"}`);
console.log(`Agent signer (delegate) ${getAddress(values.delegate)}`);
console.log("");
console.log(`${output.batch.transactions.length} transactions written to ${values.out}:`);
for (const t of output.batch.transactions) console.log(`  - ${t.contractMethod.name}(${Object.values(t.contractInputsValues).join(", ")})`);
console.log("");
console.log("After the owners sign it, the chain enforces:");
for (const a of output.allowances) console.log(`  - at most ${a.amount} ${a.asset} per ${a.resetMinutes} minutes for the agent's signer`);
console.log("");
console.log("It does NOT enforce:");
for (const note of output.notes) console.log(`  - ${note}`);
console.log("");
console.log("Nothing was signed or sent. Import the file in Safe{Wallet} > Apps > Transaction Builder, check each transaction there, and sign as the owners.");
