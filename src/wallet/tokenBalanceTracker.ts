import { Connection, PublicKey } from "@solana/web3.js";

// Current SPL token balances for an owner (classic Token + Token-2022). Used to
// reconcile detected positions against the actual on-chain wallet. Read-only.

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export interface OwnedToken {
  mint: string;
  amount: number;
  decimals: number;
}

export async function fetchTokenBalances(conn: Connection, owner: string): Promise<OwnedToken[]> {
  const ownerKey = new PublicKey(owner);
  const out: OwnedToken[] = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const res = await conn.getParsedTokenAccountsByOwner(ownerKey, { programId });
      for (const { account } of res.value) {
        const info = (account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number | null; decimals?: number } } } })
          .parsed?.info;
        const amount = info?.tokenAmount?.uiAmount ?? 0;
        if (info?.mint && amount && amount > 0) {
          out.push({ mint: info.mint, amount, decimals: info.tokenAmount?.decimals ?? 0 });
        }
      }
    } catch {
      /* skip this program on error */
    }
  }
  return out;
}
