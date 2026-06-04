// Liquidity / LP safety assessment. Pure. For pre-graduation pump.fun tokens
// liquidity lives in the bonding curve (no separate LP to burn); post-graduation
// we care whether the LP is burned/locked. Thin liquidity ⇒ do-not-alert (§1.5).

export interface LpInputs {
  liquidityUsd?: number;
  minLiquidityUsd: number;
  /** Post-grad: true = burned/locked (safe), false = removable (risk), undefined = n/a. */
  lpBurnedOrLocked?: boolean;
}

export interface LpResult {
  ok: boolean;
  thin: boolean;
  reasons: string[];
}

export function assessLp(i: LpInputs): LpResult {
  const reasons: string[] = [];
  const thin = i.liquidityUsd !== undefined && i.liquidityUsd < i.minLiquidityUsd;
  if (thin) reasons.push(`liquidity $${Math.round(i.liquidityUsd!)} < $${i.minLiquidityUsd}`);
  if (i.lpBurnedOrLocked === false) reasons.push("LP not burned/locked (removable)");
  const ok = !thin && i.lpBurnedOrLocked !== false;
  return { ok, thin, reasons };
}
