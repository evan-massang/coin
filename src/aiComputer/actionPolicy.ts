// §Phase 7 action policy — the safety boundary for the AI Computer. The browser
// agent is RESEARCH-ONLY: it may navigate to / screenshot an allowlisted set of
// read-only data sites and NOTHING ELSE. No clicks, no form submits, no wallet
// connect, no financial confirmation, no login/CAPTCHA bypass, no cookie or
// credential extraction. Every decision is auditable. Pure.

export const ALLOWED_DOMAINS = [
  "dexscreener.com",
  "rugcheck.xyz",
  "jup.ag",
  "birdeye.so",
  "coingecko.com",
  "coinpaprika.com",
  "coincap.io",
  "solscan.io",
  "solana.com",
  "pump.fun",
];

export type ActionType = "navigate" | "screenshot" | "click" | "type" | "submit" | "evaluate" | "cookies" | "download";

export interface ActionRequest {
  type: ActionType;
  url?: string;
  selector?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
}

const READ_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set(["navigate", "screenshot"]);

// Anything that smells like wallet/financial/auth interaction is hard-forbidden.
const FORBIDDEN_SELECTOR = /connect|wallet|swap|buy|sell|approve|confirm|sign|login|password|seed|phrase|private[-_ ]?key/i;

export function isDomainAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function isForbiddenSelector(selector?: string): boolean {
  return !!selector && FORBIDDEN_SELECTOR.test(selector);
}

export function checkAction(req: ActionRequest): PolicyDecision {
  if (!READ_ONLY_ACTIONS.has(req.type)) {
    return { allowed: false, reason: `action "${req.type}" is forbidden (read-only research agent)` };
  }
  if (isForbiddenSelector(req.selector)) {
    return { allowed: false, reason: "wallet/financial/auth selector is forbidden" };
  }
  if (!req.url || !isDomainAllowed(req.url)) {
    return { allowed: false, reason: `domain not on the read-only allowlist: ${req.url ?? "(none)"}` };
  }
  return { allowed: true, reason: "allowed read-only action on an allowlisted domain" };
}
