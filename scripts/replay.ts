// CLI: replay recorded events through the strategy league.
//   npm run replay -- --from <ms> --to <ms>
import { createServices } from "../src/services.js";
import { runReplay } from "../src/replay/replayBacktester.js";

function arg(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

const svc = createServices();
const { events, ranked } = runReplay(svc, arg("from") ?? 0, arg("to") ?? Number.MAX_SAFE_INTEGER, Date.now());

console.log(`Replayed ${events} recorded events through ${ranked.length} strategies:\n`);
console.log(["strategy".padEnd(16), "trades", "win%", "pnlSOL", "maxDD%", "best%", "worst%"].join("  "));
for (const r of ranked) {
  console.log(
    [
      r.name.padEnd(16),
      String(r.trades).padStart(6),
      (r.winRate * 100).toFixed(0).padStart(4),
      r.totalPnlSol.toFixed(2).padStart(6),
      r.maxDrawdownPct.toFixed(0).padStart(6),
      r.bestTradePct.toFixed(0).padStart(5),
      r.worstTradePct.toFixed(0).padStart(6),
    ].join("  "),
  );
}
process.exit(0);
