import type { AttentionEvidence, AttentionPost } from "./types.js";
import { AgentBrowser } from "../browser/agentBrowser.js";
import { log } from "../util/logger.js";

// Phase 2/3 — the ResearchAgent: collects free, public attention evidence about a
// coin/meme with NO paid API. Strictly READ-ONLY (navigate + read only). Sources,
// in reliability order (verified from this environment):
//   • Google News RSS   (fetch, reliable) — real-world / news footprint + recency
//   • Wikipedia search   (fetch, reliable) — is this a culturally-established meme?
//   • DuckDuckGo + Reddit via Playwright (OPT-IN, best-effort) — social/humanity.
// Reddit/DDG block raw fetch, so they only work through a real browser, and even
// then can be flaky — hence opt-in. The collector always returns the News+Wiki
// backbone so it is never empty when those resolve.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// ── PURE parsers (unit-tested) ──────────────────────────────────────────────

export function platformFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (/reddit\.com/.test(u)) return "reddit";
  if (/tiktok\.com/.test(u)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(u)) return "youtube";
  if (/twitter\.com|\bx\.com/.test(u)) return "twitter";
  if (/instagram\.com/.test(u)) return "instagram";
  if (/t\.me|telegram/.test(u)) return "telegram";
  if (/facebook\.com|fb\.com/.test(u)) return "facebook";
  if (/wikipedia\.org/.test(u)) return "wikipedia";
  if (/medium\.com|substack\.com/.test(u)) return "blog";
  if (/news|coindesk|cointelegraph|decrypt|theblock/.test(u)) return "news";
  return "web";
}

export function decodeDdgHref(href: string): string {
  try {
    const m = /[?&]uddg=([^&]+)/.exec(href);
    if (m) return decodeURIComponent(m[1]);
  } catch {
    /* fall through */
  }
  return href.startsWith("//") ? "https:" + href : href;
}

export function parseDdgResults(rows: { title: string; snippet: string; href: string }[]): AttentionPost[] {
  const out: AttentionPost[] = [];
  for (const r of rows) {
    const url = decodeDdgHref(r.href);
    const text = [r.title, r.snippet].filter(Boolean).join(" — ").trim();
    if (!text) continue;
    out.push({ text, platform: platformFromUrl(url) });
  }
  return out;
}

/** Bing wraps result links as /ck/a?…&u=a1<base64url>… — decode to the real URL.
 *  (Bing is the primary browser search source: verified reachable on this network,
 *  while DuckDuckGo is ISP-blocked (Telkomsel "Internet Baik") and Brave serves a
 *  bot-check captcha. The old DDG collector silently returned nothing here.) */
export function decodeBingHref(href: string): string {
  try {
    const m = /[?&]u=a1([A-Za-z0-9_-]+={0,2})/.exec(href);
    if (m) {
      const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      if (/^https?:\/\//.test(decoded)) return decoded;
    }
  } catch {
    /* fall through */
  }
  return href;
}

export function parseBingResults(rows: { title: string; snippet: string; href: string }[]): AttentionPost[] {
  const out: AttentionPost[] = [];
  for (const r of rows) {
    const url = decodeBingHref(r.href);
    const text = [r.title, r.snippet].filter(Boolean).join(" — ").trim();
    if (!text) continue;
    out.push({ text: text.slice(0, 240), platform: platformFromUrl(url) });
  }
  return out;
}

interface RedditChild { data?: { author?: string; title?: string; selftext?: string; ups?: number; created_utc?: number } }
export function postsFromReddit(json: { data?: { children?: RedditChild[] } }): AttentionPost[] {
  const out: AttentionPost[] = [];
  for (const c of json?.data?.children ?? []) {
    const d = c.data ?? {};
    const text = [d.title, (d.selftext ?? "").slice(0, 240)].filter(Boolean).join(" — ").trim();
    if (!text) continue;
    out.push({
      text,
      author: d.author && d.author !== "[deleted]" ? d.author : undefined,
      platform: "reddit",
      at: d.created_utc ? d.created_utc * 1000 : undefined,
      reactions: typeof d.ups === "number" ? d.ups : undefined,
    });
  }
  return out;
}

function xmlTag(block: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block);
  let v = m?.[1] ?? "";
  v = v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim();
}

/** Google News RSS <item>s → news posts (title + outlet + date). */
export function parseGoogleNewsRss(xml: string, max = 12): AttentionPost[] {
  const out: AttentionPost[] = [];
  const items = xml.split(/<item>/).slice(1);
  for (const raw of items.slice(0, max)) {
    const block = raw.split(/<\/item>/)[0] ?? "";
    const title = xmlTag(block, "title");
    if (!title) continue;
    const pub = xmlTag(block, "pubDate");
    const at = pub ? Date.parse(pub) : NaN;
    const src = (/<source[^>]*>([^<]*)<\/source>/.exec(block)?.[1] || "").trim();
    out.push({ text: title, author: src || undefined, platform: "news", at: Number.isFinite(at) ? at : undefined });
  }
  return out;
}

export interface WikiResult { matched: boolean; title?: string; snippet?: string; isCrypto: boolean }
/** Wikipedia search → is there a real (non-crypto) article for this meme name? */
export function parseWikipediaSearch(json: { query?: { search?: { title?: string; snippet?: string }[] } }, term: string): WikiResult {
  const hit = json?.query?.search?.[0];
  if (!hit?.title) return { matched: false, isCrypto: false };
  const title = hit.title;
  const snippet = String(hit.snippet ?? "").replace(/<[^>]+>/g, "");
  const tl = title.toLowerCase();
  const tm = term.toLowerCase();
  const matched = tl.includes(tm) || tm.includes(tl.split("(")[0].trim());
  const isCrypto = /cryptocurrency|meme\s?coin|crypto\s?token|blockchain|\bsolana\b|\berc-?20\b/i.test(`${title} ${snippet}`);
  return { matched, title, snippet, isCrypto };
}

// ── I/O ─────────────────────────────────────────────────────────────────────

export interface ResearchOptions {
  headless?: boolean;
  maxPerQuery?: number;
  /** Try social/search via a real browser (slow, best-effort). */
  useBrowser?: boolean;
  /** Browser driver: agent-browser (default; fast Rust CLI + CCTV stream) or
   *  the legacy Playwright path (also the automatic fallback when the
   *  agent-browser CLI is not installed). */
  driver?: "agent-browser" | "playwright";
  /** RESEARCH CAM lane hooks — wired so the multi-pane grid shows each lane live. */
  cam?: CamLaneHooks;
}

async function fetchGoogleNews(query: string): Promise<AttentionPost[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    return parseGoogleNewsRss(await r.text());
  } catch {
    return [];
  }
}

async function fetchWikipedia(term: string): Promise<WikiResult> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&srlimit=3`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { matched: false, isCrypto: false };
    return parseWikipediaSearch((await r.json()) as Parameters<typeof parseWikipediaSearch>[0], term);
  } catch {
    return { matched: false, isCrypto: false };
  }
}

// ── agent-browser collection (primary driver) ───────────────────────────────
// Sources verified reachable on this network 2026-06-12 with STEALTH launch
// flags (_probe_stealth.mjs): Bing web + Bing News + old.reddit + Brave + DDG —
// vanilla CDP hit bot-challenges on Brave/Reddit/DDG (0 results), the
// anti-detection flags clear them (23/22/10 results). All steps are
// open→wait→read; nothing is ever clicked or typed.

const BING_EXTRACT = `JSON.stringify([...document.querySelectorAll('li.b_algo')].slice(0,12).map(r=>({title:(r.querySelector('h2')?.textContent||'').trim(),href:r.querySelector('h2 a, a')?.href||'',snippet:(r.querySelector('.b_caption p, .b_lineclamp2, p')?.textContent||'').trim().slice(0,160)})))`;
const BING_NEWS_EXTRACT = `JSON.stringify([...document.querySelectorAll('.news-card, .newsitem, article')].slice(0,12).map(r=>({title:(r.querySelector('a.title, .title, a')?.textContent||'').trim(),href:r.querySelector('a.title, a')?.href||'',snippet:(r.querySelector('.snippet, p')?.textContent||'').trim().slice(0,160)})))`;
const OLD_REDDIT_EXTRACT = `JSON.stringify([...document.querySelectorAll('.search-result-link')].slice(0,15).map(r=>({title:(r.querySelector('.search-title')?.textContent||'').trim(),author:(r.querySelector('.author')?.textContent||'').trim()})))`;
const BRAVE_EXTRACT = `JSON.stringify([...document.querySelectorAll('.snippet[data-type=web], .snippet')].slice(0,12).map(r=>({title:(r.querySelector('.title, .snippet-title')?.textContent||'').trim(),href:r.querySelector('a')?.href||'',snippet:(r.querySelector('.snippet-description, .snippet-content p, p')?.textContent||'').trim().slice(0,160)})))`;
const DDG_EXTRACT = `JSON.stringify([...document.querySelectorAll('.result')].slice(0,12).map(r=>({title:(r.querySelector('.result__a')?.textContent||'').trim(),href:r.querySelector('.result__a')?.getAttribute('href')||'',snippet:(r.querySelector('.result__snippet')?.textContent||'').trim().slice(0,160)})))`;
const GOOGLE_EXTRACT = `JSON.stringify([...document.querySelectorAll('div.tF2Cxc, div.g, div.MjjYud')].slice(0,12).map(r=>({title:(r.querySelector('h3')?.textContent||'').trim(),href:r.querySelector('a')?.href||'',snippet:(r.querySelector('.VwiC3b, .aCOpRe, [data-sncf] span')?.textContent||'').trim().slice(0,160)})))`;
const X_EXTRACT = `JSON.stringify([...document.querySelectorAll('article')].slice(0,12).map(a=>({title:(a.querySelector('[data-testid=tweetText]')?.textContent||'').trim().slice(0,200),author:(a.querySelector('[data-testid=User-Name]')?.textContent||'').trim().slice(0,40)})))`;

// ── Research LANES — one agent-browser SESSION per source, run CONCURRENTLY ──
// Each lane is an isolated Chrome instance + WebSocket stream searching ONE
// site. They run via Promise.all so a dive takes ~the slowest lane (not the
// sum), and the RESEARCH CAM shows every lane live at once. Stealth flags
// (agentBrowser.ts) clear the bot-walls. Lanes are best-effort: a blocked or
// empty source returns [] and the others carry the dive.

export interface ResearchLaneCtx {
  term: string;
  symbol?: string;
  max: number;
}
export interface ResearchLane {
  id: string;
  label: string;
  session: string;
  run: (ab: AgentBrowser, ctx: ResearchLaneCtx) => Promise<AttentionPost[]>;
}
/** Cam lifecycle hooks — the collector tells the RESEARCH CAM which lane (and
 *  its agent-browser session) just went live, so the cam attaches that lane's
 *  stream and shows it in its own pane. */
export interface CamLaneHooks {
  laneStart: (laneId: string, label: string, session: string) => void | Promise<void>;
  laneAction: (laneId: string, text: string) => void;
  laneEnd: (laneId: string) => void;
}

type WebRow = { title: string; snippet: string; href: string };

export const RESEARCH_LANES: ResearchLane[] = [
  {
    id: "google",
    label: "Google",
    session: "mirofish-lane-google",
    run: async (ab, { term, max }) => {
      const out: AttentionPost[] = [];
      const url = `https://www.google.com/search?q=${encodeURIComponent(`"${term}" meme coin`)}&hl=en&num=20`;
      if (await ab.open(url)) {
        await ab.waitFor("div.g, div.tF2Cxc, div.MjjYud");
        const rows = await ab.evalArray<WebRow>(GOOGLE_EXTRACT, `read google for ${term}`);
        for (const r of rows.slice(0, max)) {
          const text = [r.title, r.snippet].filter(Boolean).join(" — ").trim();
          if (text) out.push({ text: text.slice(0, 240), platform: platformFromUrl(r.href || "") });
        }
      }
      return out;
    },
  },
  {
    id: "x",
    label: "X / Twitter",
    session: "mirofish-lane-x",
    run: async (ab, { term, symbol }) => {
      const out: AttentionPost[] = [];
      // Live search surface — the cam SHOWS X being searched. Extraction is
      // best-effort (X login-gates the timeline); x.com post links/snippets also
      // arrive via the Google/Brave/DDG lanes tagged "twitter".
      const url = `https://x.com/search?q=${encodeURIComponent(`${term} ${symbol ?? ""}`.trim())}&src=typed_query&f=live`;
      if (await ab.open(url)) {
        await ab.waitMs(2500);
        const rows = await ab.evalArray<{ title: string; author: string }>(X_EXTRACT, `read X for ${term}`);
        for (const r of rows.filter((x) => x.title).slice(0, 12)) {
          out.push({ text: r.title.slice(0, 240), author: r.author || undefined, platform: "twitter" });
        }
      }
      return out;
    },
  },
  {
    id: "reddit",
    label: "Reddit",
    session: "mirofish-lane-reddit",
    run: async (ab, { term, symbol }) => {
      const out: AttentionPost[] = [];
      const url = `https://old.reddit.com/search?q=${encodeURIComponent(`${term} ${symbol ?? ""}`.trim())}&sort=new`;
      if (await ab.open(url)) {
        await ab.waitFor(".search-result-link");
        const rows = await ab.evalArray<{ title: string; author: string }>(OLD_REDDIT_EXTRACT, `read reddit for ${term}`);
        for (const r of rows.filter((x) => x.title).slice(0, 15)) {
          out.push({ text: r.title.slice(0, 240), author: r.author || undefined, platform: "reddit" });
        }
      }
      return out;
    },
  },
  {
    id: "brave",
    label: "Brave",
    session: "mirofish-lane-brave",
    run: async (ab, { term }) => {
      const out: AttentionPost[] = [];
      const url = `https://search.brave.com/search?q=${encodeURIComponent(`"${term}" meme`)}`;
      if (await ab.open(url)) {
        await ab.waitFor(".snippet");
        const rows = await ab.evalArray<WebRow>(BRAVE_EXTRACT, `read brave for ${term}`);
        for (const r of rows) {
          const text = [r.title, r.snippet].filter(Boolean).join(" — ").trim();
          if (text) out.push({ text: text.slice(0, 240), platform: platformFromUrl(r.href || "") });
        }
      }
      return out;
    },
  },
  {
    id: "ddg",
    label: "DuckDuckGo",
    session: "mirofish-lane-ddg",
    run: async (ab, { term, max }) => {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${term} meme`)}`;
      if (!(await ab.open(url))) return [];
      await ab.waitFor(".result");
      const rows = await ab.evalArray<WebRow>(DDG_EXTRACT, `read duckduckgo for ${term}`);
      return parseDdgResults(rows).slice(0, max);
    },
  },
  {
    id: "bing",
    label: "Bing",
    session: "mirofish-lane-bing",
    run: async (ab, { term, symbol, max }) => {
      const out: AttentionPost[] = [];
      // Bing web (most reliable on this network) …
      const web = `https://www.bing.com/search?q=${encodeURIComponent(`"${term}" ${symbol ?? "meme"}`)}&mkt=en-US&setlang=en&count=20`;
      if (await ab.open(web)) {
        await ab.waitFor("li.b_algo");
        const rows = await ab.evalArray<WebRow>(BING_EXTRACT, `read bing web for ${term}`);
        out.push(...parseBingResults(rows).slice(0, max));
      }
      // … then Bing News (recency + outside-crypto footprint).
      const news = `https://www.bing.com/news/search?q=${encodeURIComponent(`${term} meme`)}&setlang=en`;
      if (await ab.open(news)) {
        await ab.waitFor(".news-card, article");
        const rows = await ab.evalArray<WebRow>(BING_NEWS_EXTRACT, `read bing news for ${term}`);
        for (const r of rows) {
          const text = [r.title, r.snippet].filter(Boolean).join(" — ").trim();
          if (text) out.push({ text: text.slice(0, 240), platform: "news" });
        }
      }
      return out;
    },
  },
];

// How many browser lanes run AT ONCE. All lanes at once overlaps Chrome's slow
// cold-start on this iGPU (waving them instead SERIALIZES the cold-starts and is
// markedly slower); paired with the concurrent HTTP backbone this is the fastest
// config measured here AND shows every bot searching simultaneously in the cam.
const LANE_CONCURRENCY = RESEARCH_LANES.length;

/** Bounded-concurrency pool — preserves item order in the result array. */
async function runPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function collectViaAgentBrowser(
  term: string,
  symbol: string | undefined,
  max: number,
  cam?: CamLaneHooks,
): Promise<AttentionPost[]> {
  // Fan out with a concurrency cap: up to LANE_CONCURRENCY lanes search at once,
  // each in its own browser session/stream; the rest queue and start as slots free.
  const results = await runPool(RESEARCH_LANES, LANE_CONCURRENCY, async (lane) => {
    const ab = new AgentBrowser({ session: lane.session, onAction: (t) => cam?.laneAction(lane.id, t) });
    try {
      // Launch THIS lane's daemon first (sole launcher), THEN let the cam attach
      // its stream — so the cam never races the daemon launch.
      await ab.warmup();
      await cam?.laneStart(lane.id, lane.label, lane.session);
      return await lane.run(ab, { term, symbol, max });
    } catch (e) {
      log.warn(`research lane ${lane.id} failed: ${(e as Error).message}`);
      return [] as AttentionPost[];
    } finally {
      cam?.laneEnd(lane.id);
    }
  });
  const posts = results.flat();
  cam?.laneAction("all", `dive done — ${posts.length} posts from ${RESEARCH_LANES.length} lanes`);
  return posts;
}

async function ddgSearch(page: any, query: string, max: number): Promise<AttentionPost[]> {
  try {
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 12000 });
    const rows = (await page.$$eval(
      ".result",
      (els: any[], n: number) =>
        els.slice(0, n).map((e: any) => ({
          title: e.querySelector(".result__a")?.textContent?.trim() || "",
          snippet: e.querySelector(".result__snippet")?.textContent?.trim() || "",
          href: e.querySelector(".result__a")?.getAttribute("href") || "",
        })),
      max,
    )) as { title: string; snippet: string; href: string }[];
    return parseDdgResults(rows);
  } catch {
    return [];
  }
}

async function redditBrowser(page: any, query: string, max: number): Promise<AttentionPost[]> {
  try {
    await page.goto(`https://old.reddit.com/search?q=${encodeURIComponent(query)}&sort=new`, { waitUntil: "domcontentloaded", timeout: 14000 });
    const rows = (await page.$$eval(
      ".search-result-link",
      (els: any[], n: number) =>
        els.slice(0, n).map((e: any) => ({
          title: e.querySelector(".search-title")?.textContent?.trim() || "",
          author: e.querySelector(".author")?.textContent?.trim() || "",
        })),
      max,
    )) as { title: string; author: string }[];
    return rows.filter((r) => r.title).map((r) => ({ text: r.title, author: r.author || undefined, platform: "reddit" }));
  } catch {
    return [];
  }
}

/** Collect public attention evidence for a coin. Read-only, best-effort, free. */
export async function collectEvidence(
  coin: { mint: string; symbol?: string; name?: string },
  opts: ResearchOptions = {},
): Promise<AttentionEvidence> {
  const now = Date.now();
  const term = (coin.name || coin.symbol || "").trim();
  const posts: AttentionPost[] = [];
  const platforms = new Set<string>();
  if (!term) return { mint: coin.mint, symbol: coin.symbol, name: coin.name, query: "", posts, platforms: [], links: [], fetchedAt: now };

  // 1+2) HTTP BACKBONE — Google News RSS + Wikipedia. These are plain fetches
  // (no Chrome), so we run them CONCURRENTLY with the browser lanes below instead
  // of blocking ~25-30s in front of them. Kicked off here, awaited at the end.
  const backbone = (async (): Promise<AttentionPost[]> => {
    const out: AttentionPost[] = [];
    const newsBatches = await Promise.all(
      [`${term} meme`, coin.symbol ? `${coin.symbol} coin` : ""].filter(Boolean).map((q) => fetchGoogleNews(q)),
    );
    for (const news of newsBatches) {
      if (news.length) {
        out.push(...news);
        platforms.add("news");
      }
    }
    const wiki = await fetchWikipedia(term);
    if (wiki.matched && !wiki.isCrypto && wiki.title) {
      out.push({ text: `Wikipedia: ${wiki.title} — ${wiki.snippet ?? ""}`.slice(0, 240), platform: "wikipedia" });
      platforms.add("wikipedia");
    }
    return out;
  })();

  // 3) Social/search via real browser (opt-in). Primary driver: agent-browser
  //    (fast Rust CLI; streams to the dashboard RESEARCH CAM). Playwright stays
  //    as the automatic fallback when the CLI is not installed.
  if (opts.useBrowser) {
    const max = opts.maxPerQuery ?? 8;
    let collected = false;
    if (opts.driver !== "playwright" && (await AgentBrowser.available())) {
      try {
        for (const p of await collectViaAgentBrowser(term, coin.symbol, max, opts.cam)) {
          posts.push(p);
          platforms.add(p.platform);
        }
        collected = true;
      } catch (e) {
        log.warn(`attention: agent-browser dive failed (${(e as Error).message}) — trying playwright`);
      }
    }
    const spec = "playwright";
    let pw: any = null;
    if (!collected) {
      try {
        pw = await import(spec);
      } catch {
        log.warn("attention: no browser driver available — News+Wiki only");
      }
    }
    if (pw?.chromium) {
      let browser: any;
      try {
        browser = await pw.chromium.launch({ headless: opts.headless ?? true });
        // ignoreHTTPSErrors: this machine has an HTTPS-inspection layer (AV/firewall)
        // that trips ERR_CERT_AUTHORITY_INVALID on reddit/ddg; bypass it for reads.
        const page = await (await browser.newContext({ userAgent: UA, ignoreHTTPSErrors: true })).newPage();
        for (const p of await redditBrowser(page, `${term} ${coin.symbol ?? ""}`.trim(), 15)) {
          posts.push(p);
          platforms.add("reddit");
        }
        for (const [q] of [[`"${term}" meme`], [`${term} site:tiktok.com`], [`${term} site:youtube.com`]] as [string][]) {
          for (const p of await ddgSearch(page, q, max)) {
            posts.push(p);
            platforms.add(p.platform);
          }
        }
      } catch (e) {
        log.warn(`attention: browser search failed: ${(e as Error).message}`);
      } finally {
        try {
          await browser?.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Merge the HTTP backbone (it ran concurrently with the browser lanes).
  posts.push(...(await backbone.catch(() => [])));

  // Dedup — different search engines surface the same article/post (and some
  // localize it), so collapse on platform + normalized text.
  const deduped: AttentionPost[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    const key = `${p.platform}|${p.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 90)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  return { mint: coin.mint, symbol: coin.symbol, name: coin.name, query: term, posts: deduped, platforms: [...platforms], links: [], fetchedAt: now };
}
