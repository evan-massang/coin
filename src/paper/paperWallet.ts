import type { PaperRepo, PaperWalletState } from "../store/repositories/paperRepo.js";

// Thin SOL-balance wrapper over the paper_wallet singleton. Simulation only.
export class PaperWallet {
  constructor(private readonly repo: PaperRepo) {}

  ensure(startingBalanceSol: number): PaperWalletState {
    return this.repo.ensure(startingBalanceSol);
  }

  balance(): number {
    return this.repo.get()?.balanceSol ?? 0;
  }

  /** Returns false if there isn't enough sim balance. */
  debit(sol: number): boolean {
    const bal = this.balance();
    if (sol > bal + 1e-9) return false;
    this.repo.setBalance(bal - sol);
    return true;
  }

  credit(sol: number): void {
    this.repo.setBalance(this.balance() + sol);
  }

  reset(startingBalanceSol: number): void {
    this.repo.reset(startingBalanceSol);
  }
}
