import type { CreatorStats } from "../store/repositories/creatorHistoryRepo.js";

// Deployer reputation → a risk multiplier. Repeat ruggers get heavily cut; a
// clean serial deployer with prior winners gets a small bonus. Pure. Never
// auto-buys — it only sizes / flags.

export interface DeployerVerdict {
  multiplier: number;
  reasons: string[];
}

export function deployerReputation(stats: CreatorStats | undefined): DeployerVerdict {
  if (!stats || stats.launches < 2) return { multiplier: 1, reasons: [] };
  const rugRate = stats.rugs / stats.launches;
  if (rugRate >= 0.5) return { multiplier: 0.1, reasons: [`deployer rugged ${stats.rugs}/${stats.launches}`] };
  if (rugRate >= 0.3) return { multiplier: 0.25, reasons: [`deployer rug rate ${(rugRate * 100).toFixed(0)}%`] };
  if (rugRate >= 0.15) return { multiplier: 0.4, reasons: [`deployer rug rate ${(rugRate * 100).toFixed(0)}%`] };
  if (stats.winners > 0 && stats.rugs === 0 && stats.launches >= 3) {
    return { multiplier: 1.1, reasons: [`deployer: ${stats.winners} prior winners, no rugs`] };
  }
  return { multiplier: 1, reasons: [] };
}
