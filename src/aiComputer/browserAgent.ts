import { checkAction } from "./actionPolicy.js";

// Headless, read-only Playwright capture. Every navigation + screenshot is
// policy-gated. Playwright is an OPTIONAL dependency: if it (or a browser) isn't
// installed, this degrades to { available: false } and the AI Computer runs
// council-only. It opens an ephemeral context, navigates, screenshots — and does
// NOTHING else (no clicks, no wallet, no input).

export interface CaptureResult {
  available: boolean;
  screenshot?: Buffer;
  error?: string;
}

export async function captureEvidence(url: string, timeoutMs = 15_000): Promise<CaptureResult> {
  const nav = checkAction({ type: "navigate", url });
  if (!nav.allowed) return { available: true, error: nav.reason };
  const shot = checkAction({ type: "screenshot", url });
  if (!shot.allowed) return { available: true, error: shot.reason };

  // Variable specifier keeps TS from requiring the optional module at compile.
  // Playwright has no static types here (optional dep), so it's `any`.
  const spec = "playwright";
  let pw: any = null;
  try {
    pw = await import(spec);
  } catch {
    return { available: false, error: "playwright not installed (council-only mode)" };
  }
  if (!pw?.chromium) return { available: false, error: "no chromium" };

  let browser: any;
  try {
    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext(); // ephemeral, no stored profile
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const screenshot = (await page.screenshot({ fullPage: false })) as Buffer;
    return { available: true, screenshot };
  } catch (e) {
    return { available: true, error: (e as Error).message };
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
