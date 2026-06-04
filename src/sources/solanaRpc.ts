import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "../config.js";
import type { Settings } from "../store/settingsStore.js";

// Solana RPC helpers. A Helius key in Settings takes precedence over the
// bootstrap RPC URL. Read-only: this module never builds or signs transactions.

export function rpcUrlFrom(settings: Pick<Settings, "heliusApiKey">): string {
  if (settings.heliusApiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`;
  }
  return config.rpcUrl;
}

export function makeConnection(settings: Pick<Settings, "heliusApiKey">): Connection {
  // disableRetryOnRateLimit: on a 429 we want an immediate failure → UNKNOWN in
  // the gate, NOT the web3.js client silently retry-spamming the public RPC.
  return new Connection(rpcUrlFrom(settings), {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
  });
}

/** True for a syntactically valid base58 Solana public key. */
export function isValidSolanaAddress(addr: string): boolean {
  if (!addr || addr.length < 32 || addr.length > 44) return false;
  try {
    // PublicKey throws on invalid base58 / wrong length.
    void new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

export async function getSolBalance(conn: Connection, addr: string): Promise<number> {
  const lamports = await conn.getBalance(new PublicKey(addr));
  return lamports / LAMPORTS_PER_SOL;
}
