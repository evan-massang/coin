import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// HARD INVARIANT GUARD (CLAUDE.md Rule 1 / Hermes Phase 10): this engine is
// SIGNAL-EMITTING + PAPER-TRADING ONLY. It never holds a key, never signs, never
// sends a transaction. Real trades are the operator's manual action.
//
// Hermes "Phase 10: execute live trade" must NEVER become autonomous signing.
// This test fails the build if any Solana transaction-signing/sending symbol
// appears anywhere in PRODUCTION src — so the invariant can't silently regress
// (e.g. a future "live mode" sneaking in a Keypair). Test files are excluded so a
// mock can reference these names; production code may not.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN = [
  "Keypair",
  "secretKey",
  "fromSecretKey",
  "signTransaction",
  "signAllTransactions",
  "sendTransaction",
  "sendRawTransaction",
  "partialSign",
];

function productionTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...productionTsFiles(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("no-signing-path invariant (the engine never signs or sends)", () => {
  it("contains no transaction-signing/sending symbols anywhere in production src", () => {
    const offenders: string[] = [];
    for (const file of productionTsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const sym of FORBIDDEN) {
        // word-boundary match so comments like "never signs" can't trip it
        if (new RegExp(`\\b${sym}\\b`).test(text)) offenders.push(`${file.slice(SRC.length + 1)} → ${sym}`);
      }
    }
    expect(offenders, `signing symbols found in production code:\n${offenders.join("\n")}`).toEqual([]);
  });
});
