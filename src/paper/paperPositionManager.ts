import type { Services } from "../services.js";
import { PositionManager } from "../engine/positionManager.js";

// Paper positions reuse the same PositionManager as the real wallet observer —
// identical cost-basis + PnL math — just bound to the paper_positions table.
// This factory keeps that wiring in one place (Part 5 file: paperPositionManager).
export function createPaperPositionManager(svc: Services): PositionManager {
  return new PositionManager(svc.paperPositions, "paper");
}
