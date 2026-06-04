// Wallet-cluster risk: if a token's buyers form a cluster that has overlapped on
// prior rugs, raise the risk (shrink the size). Pure given the overlap count.

export interface ClusterVerdict {
  multiplier: number;
  reasons: string[];
}

export function clusterRisk(rugOverlap: number): ClusterVerdict {
  if (rugOverlap >= 3) return { multiplier: 0.4, reasons: ["buyers form a known rug-prone cluster"] };
  if (rugOverlap >= 1) return { multiplier: 0.7, reasons: ["buyers overlap with prior rugs"] };
  return { multiplier: 1, reasons: [] };
}
