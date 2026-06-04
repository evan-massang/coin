// Shared timeout helpers. `withTimeout` rejects on deadline; `runWithTimeout`
// resolves to a fallback instead of throwing (handy for best-effort agents).

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function runWithTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  try {
    return await withTimeout(p, ms);
  } catch {
    return fallback;
  }
}
