import type { Alert, AlertLinks, Decision, Verdict } from "../types.js";

// Deeplinks (Part 4). The user trades manually — these just open the right page.
export function buildLinks(mint: string): AlertLinks {
  return {
    phantom: `https://phantom.com/tokens/solana/${mint}`,
    jupiter: `https://jup.ag/swap/SOL-${mint}`,
    dexscreener: `https://dexscreener.com/solana/${mint}`,
    rugcheck: `https://rugcheck.xyz/tokens/${mint}`,
    solscan: `https://solscan.io/token/${mint}`,
  };
}

export function decisionToAlert(d: Decision): Alert {
  return {
    kind: d.verdict,
    mint: d.mint,
    symbol: d.symbol,
    name: d.name,
    conviction: d.conviction,
    scores: d.scores,
    reasons: d.reasons,
    flags: d.flags,
    links: buildLinks(d.mint),
    at: d.at,
  };
}

const EMOJI: Record<Verdict, string> = {
  BUY_STRONG: "🟢🟢",
  BUY_SMALL: "🟢",
  WATCH_ONLY: "👀",
  AVOID: "🛑",
  TOO_LATE: "⏰",
  SELL_TRIM: "🟡",
  SELL_EXIT_NOW: "🔴",
};

/** Title + body for a desktop notification. */
export function notificationText(a: Alert): { title: string; message: string } {
  const tag = a.symbol ? `$${a.symbol}` : `${a.mint.slice(0, 6)}…`;
  const title = `${EMOJI[a.kind]} ${a.kind} ${tag} (${a.conviction})`;
  const top = a.reasons.slice(0, 2).join(" · ");
  const message = top || a.mint;
  return { title, message };
}
