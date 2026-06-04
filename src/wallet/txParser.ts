import { LAMPORTS_PER_SOL } from "@solana/web3.js";

// Pure extraction of a watched owner's SOL + token balance deltas from a parsed
// transaction. Structurally typed to the subset of ParsedTransactionWithMeta we
// read, so it's testable with plain fixtures (no live RPC).

interface AccountKeyLike {
  pubkey: { toBase58(): string } | string;
}
interface TokenBalanceLike {
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmount: number | null; amount: string; decimals: number };
}
export interface ParsedTxLike {
  blockTime?: number | null;
  transaction: { signatures: string[]; message: { accountKeys: Array<AccountKeyLike | string> } };
  meta: {
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalanceLike[] | null;
    postTokenBalances?: TokenBalanceLike[] | null;
  } | null;
}

export interface TxDeltas {
  signature: string;
  at: number;
  solDelta: number; // SOL gained(+)/spent(-) by the owner
  tokens: Array<{ mint: string; tokenDelta: number }>;
}

function keyToStr(k: AccountKeyLike | string): string {
  if (typeof k === "string") return k;
  return typeof k.pubkey === "string" ? k.pubkey : k.pubkey.toBase58();
}

function uiAmount(b: TokenBalanceLike): number {
  if (b.uiTokenAmount.uiAmount != null) return b.uiTokenAmount.uiAmount;
  const raw = Number(b.uiTokenAmount.amount);
  return Number.isFinite(raw) ? raw / 10 ** b.uiTokenAmount.decimals : 0;
}

export function parseTxDeltas(tx: ParsedTxLike, owner: string): TxDeltas | undefined {
  if (!tx.meta) return undefined;
  const keys = tx.transaction.message.accountKeys.map(keyToStr);
  const idx = keys.indexOf(owner);

  let solDelta = 0;
  if (idx >= 0 && tx.meta.preBalances[idx] != null && tx.meta.postBalances[idx] != null) {
    solDelta = (tx.meta.postBalances[idx]! - tx.meta.preBalances[idx]!) / LAMPORTS_PER_SOL;
  }

  const pre = new Map<string, number>();
  for (const b of tx.meta.preTokenBalances ?? []) {
    if (b.owner === owner) pre.set(b.mint, uiAmount(b));
  }
  const post = new Map<string, number>();
  for (const b of tx.meta.postTokenBalances ?? []) {
    if (b.owner === owner) post.set(b.mint, uiAmount(b));
  }

  const mints = new Set<string>([...pre.keys(), ...post.keys()]);
  const tokens: Array<{ mint: string; tokenDelta: number }> = [];
  for (const mint of mints) {
    const delta = (post.get(mint) ?? 0) - (pre.get(mint) ?? 0);
    if (Math.abs(delta) > 1e-9) tokens.push({ mint, tokenDelta: delta });
  }

  return {
    signature: tx.transaction.signatures[0] ?? "",
    at: (tx.blockTime ?? 0) * 1000 || Date.now(),
    solDelta,
    tokens,
  };
}
