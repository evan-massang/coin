// Position PnL math. Pure + SOL-denominated (a Solana trader thinks in SOL).
// Weighted-average cost basis on buys; realized PnL on sells; mark-to-market
// unrealized on the current price.

export interface PnlState {
  tokenAmount: number;
  avgEntryPriceSol: number; // SOL per token
  costBasisSol: number; // SOL still invested in the remaining tokens
  realizedPnlSol: number;
}

export function emptyPnl(): PnlState {
  return { tokenAmount: 0, avgEntryPriceSol: 0, costBasisSol: 0, realizedPnlSol: 0 };
}

/** Add a buy: weighted-average the entry price. */
export function applyBuy(state: PnlState, tokenAmount: number, solSpent: number): PnlState {
  if (tokenAmount <= 0) return state;
  const newTokens = state.tokenAmount + tokenAmount;
  const newCost = state.costBasisSol + solSpent;
  return {
    tokenAmount: newTokens,
    costBasisSol: newCost,
    avgEntryPriceSol: newTokens > 0 ? newCost / newTokens : 0,
    realizedPnlSol: state.realizedPnlSol,
  };
}

/** Apply a sell: realize PnL against the average entry; reduce cost basis. */
export function applySell(
  state: PnlState,
  tokenAmount: number,
  solReceived: number,
): { state: PnlState; realizedDeltaSol: number } {
  if (tokenAmount <= 0 || state.tokenAmount <= 0) return { state, realizedDeltaSol: 0 };
  const sold = Math.min(tokenAmount, state.tokenAmount);
  const costOfSold = state.avgEntryPriceSol * sold;
  // Scale proceeds if the sell amount exceeds tracked holdings (defensive).
  const proceeds = tokenAmount > 0 ? solReceived * (sold / tokenAmount) : solReceived;
  const realizedDeltaSol = proceeds - costOfSold;
  const remaining = state.tokenAmount - sold;
  return {
    state: {
      tokenAmount: remaining,
      avgEntryPriceSol: remaining > 0 ? state.avgEntryPriceSol : 0,
      costBasisSol: Math.max(0, state.costBasisSol - costOfSold),
      realizedPnlSol: state.realizedPnlSol + realizedDeltaSol,
    },
    realizedDeltaSol,
  };
}

/** Unrealized PnL in SOL at the current price. */
export function unrealizedSol(state: PnlState, currentPriceSol: number): number {
  if (state.tokenAmount <= 0) return 0;
  return (currentPriceSol - state.avgEntryPriceSol) * state.tokenAmount;
}
