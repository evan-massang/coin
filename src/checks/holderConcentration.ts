import { Connection, PublicKey } from "@solana/web3.js";

// Top-holder concentration via getTokenLargestAccounts + getTokenSupply.
//
// Caveat for brand-new pump.fun tokens: the bonding-curve account holds almost
// all supply, so the single largest account is the curve, not a "holder". When
// the largest account dwarfs everything (>80% of supply) we report concentration
// as UNKNOWN rather than risk a false hard-fail; otherwise we use the largest
// real holder. Read-only, never throws.

export interface HolderConcentration {
  /** Largest holder % to feed Stage-0 (undefined ⇒ UNKNOWN). */
  topHolderPct?: number;
  top10Pct?: number;
  holderAccounts?: number;
  /** The raw largest-account %, for diagnostics. */
  largestPct?: number;
}

export async function fetchHolderConcentration(conn: Connection, mint: string): Promise<HolderConcentration> {
  try {
    const key = new PublicKey(mint);
    const [largest, supplyResp] = await Promise.all([
      conn.getTokenLargestAccounts(key),
      conn.getTokenSupply(key),
    ]);
    const supply = Number(supplyResp.value.amount);
    if (!supply || !largest.value.length) return {};

    const amounts = largest.value.map((a) => Number(a.amount)).sort((a, b) => b - a);
    const largestPct = (amounts[0]! / supply) * 100;
    const top10Pct = (amounts.slice(0, 10).reduce((a, b) => a + b, 0) / supply) * 100;

    // Largest dwarfs the rest ⇒ almost certainly the bonding curve/LP ⇒ UNKNOWN.
    if (largestPct > 80) {
      return { topHolderPct: undefined, top10Pct, holderAccounts: largest.value.length, largestPct };
    }
    return { topHolderPct: largestPct, top10Pct, holderAccounts: largest.value.length, largestPct };
  } catch {
    return {};
  }
}
