import type { TxDeltas } from "./txParser.js";

// Turn raw tx deltas into buy/sell activities. The common case (a manual
// Phantom/Jupiter swap) touches exactly one token, so we attribute the whole
// SOL delta to it and can derive a price. Multi-token txs still record the token
// movement (entered/closed) but with an unknown price (solAmount 0).

export interface WalletActivity {
  mint: string;
  side: "buy" | "sell";
  tokenAmount: number;
  solAmount: number; // SOL spent (buy) / received (sell); 0 if undeterminable
  priceSol: number; // SOL per token; 0 if unknown
  at: number;
  signature: string;
}

export function detectActivities(d: TxDeltas): WalletActivity[] {
  const moved = d.tokens.filter((t) => Math.abs(t.tokenDelta) > 1e-9);
  if (moved.length === 0) return [];
  const single = moved.length === 1;

  return moved.map((t) => {
    const side: "buy" | "sell" = t.tokenDelta > 0 ? "buy" : "sell";
    const tokenAmount = Math.abs(t.tokenDelta);
    let solAmount = 0;
    if (single) {
      // Buy: SOL decreased (solDelta<0). Sell: SOL increased (solDelta>0).
      solAmount = side === "buy" ? Math.max(0, -d.solDelta) : Math.max(0, d.solDelta);
    }
    const priceSol = solAmount > 0 && tokenAmount > 0 ? solAmount / tokenAmount : 0;
    return { mint: t.mint, side, tokenAmount, solAmount, priceSol, at: d.at, signature: d.signature };
  });
}
