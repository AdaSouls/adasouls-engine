import { createPublicClient, http, erc20Abi } from "viem";
import { baseSepolia } from "viem/chains";
import type { ChainAdapter, TransactionStatus } from "../types.js";

/** Base's own public Sepolia RPC -- no API key/account signup needed, per the point of picking Safe for this phase. */
export const BASE_SEPOLIA_PUBLIC_RPC = "https://sepolia.base.org";

// Type left to inference deliberately -- @safe-global/protocol-kit pulls
// in its own copy of viem, and an explicit `PublicClient` annotation
// here collides with that duplicate (two structurally-identical but
// "unrelated" types, per a real tsc error hit building this).
function createClient(rpcUrl: string) {
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
}

export class BaseSepoliaChainAdapter implements ChainAdapter {
  readonly chain = "base-sepolia";
  private readonly client: ReturnType<typeof createClient>;

  constructor(rpcUrl: string = BASE_SEPOLIA_PUBLIC_RPC) {
    this.client = createClient(rpcUrl);
  }

  async getBalance(address: string, asset: string): Promise<string> {
    if (asset === "native") {
      const balance = await this.client.getBalance({ address: address as `0x${string}` });
      return balance.toString();
    }
    const balance = await this.client.readContract({
      address: asset as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    return balance.toString();
  }

  async getTransactionStatus(txHash: string): Promise<TransactionStatus> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash: txHash as `0x${string}` });
      return receipt.status === "success" ? "confirmed" : "failed";
    } catch {
      // Not yet mined (or doesn't exist) -- viem throws when a receipt
      // isn't found yet, which per 09-custody-and-key-management.md's
      // failure-semantics requirement is genuinely ambiguous at this
      // point (submitted-but-unconfirmed vs never-broadcast), not a
      // hard failure -- reported as "pending", left to the caller to
      // reconcile (10-economic-action-lifecycle.md's needsReconciliation),
      // not silently retried or assumed.
      return "pending";
    }
  }
}
