import type { SafetyCheck, SafetyResult } from "../types.js";
import { assessLp } from "../checks/lpSafety.js";

// ─────────────────────────────────────────────────────────────────────────────
// Two-stage safety gate (§1.2). PURE evaluators — all network data is gathered
// elsewhere (checks/*) and passed in, so this is fully unit-testable offline.
//
//   Stage-0 (sub-second hard kill): authorities, deployer blacklist, metadata,
//           obvious bundle/sniper, early holder concentration. Any fatal FAIL
//           ⇒ AVOID, no further compute.
//   Stage-1 (post-observation, survivors only): dev-wallet movement, top-holder
//           distribution, fresh-wallet ratio, bundle score. Promotes a token to
//           scoring; can still hard-fail (e.g. dev dumped during observation).
//
// A check value of `undefined` means UNKNOWN (we couldn't determine it) — that
// never fails the gate but raises unknownCount, which caps conviction (§1.6).
// ─────────────────────────────────────────────────────────────────────────────

export interface Stage0Inputs {
  metadata: { name?: string; symbol?: string; uri?: string };
  /** true = revoked (safe), false = still active (FATAL), undefined = unknown. */
  mintAuthorityRevoked?: boolean;
  /** true = null (safe), false = present (FATAL), undefined = unknown. */
  freezeAuthorityNull?: boolean;
  deployerBlacklisted: boolean;
  /** Largest single non-curve holder %, excluding the bonding curve / LP. */
  topHolderPct?: number;
  /** Obvious bundle / sniper cluster at launch. */
  bundleDetected?: boolean;
  /** RugCheck verdict (resolves unknowns; honeypot is the only new hard-fail). */
  rugcheck?: { riskLevel: "low" | "medium" | "danger" | "unknown"; highRisk: boolean; honeypot?: boolean };
  /** Liquidity facts (non-fatal; undefined for brand-new pre-grad tokens). */
  lp?: { liquidityUsd?: number; lpLockedPct?: number };
}

export interface SafetyConfig {
  /** A single holder above this % is an early-concentration hard fail. */
  maxTopHolderPct: number;
  /** Below this USD liquidity is flagged (non-fatal). */
  minLiquidityUsd?: number;
}

export interface Stage1Inputs {
  /** Dev wallet sold during the observation window. */
  devWalletSold?: boolean;
  /** A top holder is visibly distributing. */
  topHolderDistributing?: boolean;
  /** Fraction of buyers that are brand-new/fresh wallets, 0..1. */
  freshWalletRatio?: number;
  /** Composite bundle/insider score, 0..100 (higher = worse). */
  bundleScore?: number;
}

function check(id: string, label: string, status: SafetyCheck["status"], fatal: boolean, detail?: string): SafetyCheck {
  return { id, label, status, fatal, detail };
}

function finalize(checks: SafetyCheck[], stage: 0 | 1): SafetyResult {
  const fatalReasons = checks.filter((c) => c.fatal && c.status === "FAIL").map((c) => c.detail ?? c.label);
  const unknownCount = checks.filter((c) => c.status === "UNKNOWN").length;
  const pass = fatalReasons.length === 0;
  // Informational score: PASS=+, UNKNOWN=neutral-ish, FAIL=−, scaled to 0..100.
  const scored = checks.filter((c) => c.status !== "UNKNOWN");
  const passes = scored.filter((c) => c.status === "PASS").length;
  const score = scored.length ? Math.round((passes / scored.length) * 100) : 50;
  return { pass, stage, checks, unknownCount, fatalReasons, score };
}

export function evaluateStage0(inp: Stage0Inputs, cfg: SafetyConfig): SafetyResult {
  const checks: SafetyCheck[] = [];

  // Mint authority must be revoked (else dev can mint infinite supply).
  checks.push(
    inp.mintAuthorityRevoked === undefined
      ? check("mintAuthority", "Mint authority", "UNKNOWN", true)
      : check(
          "mintAuthority",
          "Mint authority",
          inp.mintAuthorityRevoked ? "PASS" : "FAIL",
          true,
          inp.mintAuthorityRevoked ? "revoked" : "mint authority NOT revoked (can inflate supply)",
        ),
  );

  // Freeze authority must be null (else accounts can be frozen — honeypot).
  checks.push(
    inp.freezeAuthorityNull === undefined
      ? check("freezeAuthority", "Freeze authority", "UNKNOWN", true)
      : check(
          "freezeAuthority",
          "Freeze authority",
          inp.freezeAuthorityNull ? "PASS" : "FAIL",
          true,
          inp.freezeAuthorityNull ? "null" : "freeze authority present (can freeze/honeypot)",
        ),
  );

  // Deployer blacklist.
  checks.push(
    check(
      "deployer",
      "Deployer reputation",
      inp.deployerBlacklisted ? "FAIL" : "PASS",
      true,
      inp.deployerBlacklisted ? "deployer is blacklisted" : undefined,
    ),
  );

  // Metadata completeness. No name AND no symbol ⇒ fatal; missing uri ⇒ unknown.
  const hasName = !!inp.metadata.name?.trim();
  const hasSymbol = !!inp.metadata.symbol?.trim();
  if (!hasName && !hasSymbol) {
    checks.push(check("metadata", "Metadata", "FAIL", true, "no name or symbol"));
  } else if (!inp.metadata.uri?.trim()) {
    checks.push(check("metadata", "Metadata", "UNKNOWN", false, "missing metadata uri"));
  } else {
    checks.push(check("metadata", "Metadata", "PASS", false));
  }

  // Early holder concentration.
  if (inp.topHolderPct === undefined) {
    checks.push(check("holderConcentration", "Top holder %", "UNKNOWN", false));
  } else {
    const fail = inp.topHolderPct > cfg.maxTopHolderPct;
    checks.push(
      check(
        "holderConcentration",
        "Top holder %",
        fail ? "FAIL" : "PASS",
        true,
        `top holder ${inp.topHolderPct.toFixed(1)}% (max ${cfg.maxTopHolderPct}%)`,
      ),
    );
  }

  // Obvious bundle / sniper cluster.
  if (inp.bundleDetected === undefined) {
    checks.push(check("bundle", "Bundle/sniper", "UNKNOWN", false));
  } else {
    checks.push(
      check("bundle", "Bundle/sniper", inp.bundleDetected ? "FAIL" : "PASS", true, inp.bundleDetected ? "bundle/sniper cluster at launch" : undefined),
    );
  }

  // RugCheck risk. Lenient: only a honeypot hard-fails; warn/medium just shows.
  if (inp.rugcheck === undefined) {
    checks.push(check("rugcheckRisk", "RugCheck", "UNKNOWN", false));
  } else if (inp.rugcheck.honeypot) {
    checks.push(check("rugcheckRisk", "RugCheck", "FAIL", true, "RugCheck: honeypot / cannot-sell risk"));
  } else {
    checks.push(check("rugcheckRisk", "RugCheck", "PASS", false, `RugCheck: ${inp.rugcheck.riskLevel} risk`));
  }

  // Liquidity (non-fatal). Only added when we actually have a number, so it
  // never inflates unknownCount for brand-new pre-grad tokens.
  if (inp.lp?.liquidityUsd !== undefined) {
    const lp = assessLp({
      liquidityUsd: inp.lp.liquidityUsd,
      minLiquidityUsd: cfg.minLiquidityUsd ?? 0,
      lpBurnedOrLocked: inp.lp.lpLockedPct !== undefined ? inp.lp.lpLockedPct > 0 : undefined,
    });
    checks.push(check("liquidity", "Liquidity", lp.ok ? "PASS" : "FAIL", false, lp.reasons.join("; ") || undefined));
  }

  return finalize(checks, 0);
}

/**
 * Stage-1 builds on the Stage-0 result (only run for survivors). It can add new
 * fatal fails discovered during observation. If Stage-0 didn't pass, Stage-1 is
 * a no-op pass-through (we never observe a token that already hard-failed).
 */
export function evaluateStage1(stage0: SafetyResult, inp: Stage1Inputs): SafetyResult {
  if (!stage0.pass) return { ...stage0, stage: 1 };

  const checks: SafetyCheck[] = [...stage0.checks];

  checks.push(
    inp.devWalletSold === undefined
      ? check("devMovement", "Dev wallet movement", "UNKNOWN", false)
      : check("devMovement", "Dev wallet movement", inp.devWalletSold ? "FAIL" : "PASS", true, inp.devWalletSold ? "dev wallet sold during observation" : undefined),
  );

  checks.push(
    inp.topHolderDistributing === undefined
      ? check("topHolderMovement", "Top holder movement", "UNKNOWN", false)
      : check("topHolderMovement", "Top holder movement", inp.topHolderDistributing ? "FAIL" : "PASS", true, inp.topHolderDistributing ? "top holder distributing" : undefined),
  );

  if (inp.freshWalletRatio !== undefined) {
    const fail = inp.freshWalletRatio >= 0.85;
    checks.push(check("freshWallets", "Fresh-wallet ratio", fail ? "FAIL" : "PASS", true, `${Math.round(inp.freshWalletRatio * 100)}% fresh wallets`));
  } else {
    checks.push(check("freshWallets", "Fresh-wallet ratio", "UNKNOWN", false));
  }

  if (inp.bundleScore !== undefined) {
    const fail = inp.bundleScore >= 80;
    checks.push(check("bundleScore", "Bundle score", fail ? "FAIL" : "PASS", true, `bundle score ${Math.round(inp.bundleScore)}`));
  } else {
    checks.push(check("bundleScore", "Bundle score", "UNKNOWN", false));
  }

  return finalize(checks, 1);
}
