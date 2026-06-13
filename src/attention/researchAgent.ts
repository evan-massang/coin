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
  /** Narrator hook — every browser step is reported here (RESEARCH CAM ticker). */
  onAction?: (text: string) => void;
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

async function collectViaAgentBrowser(
  term: string,
  symbol: string | undefined,
  max: number,
  onAction?: (text: string) => void,
): Promise<AttentionPost[]> {
  const ab = new AgentBrowser({ session: "mirofish-research", onAction });
  const posts: AttentionPost[] = [];
  type Row = { title: string; snippet: string; href: string };

  // 1) Bing web — the meme + the ticker (en-US market so markup is stable).
  for (const q of [`"${term}" meme`, symbol ? `${symbol} solana coin` : ""].filter(Boolean).slice(0, 2)) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&mkt=en-US&setlang=en&count=20`;
    if (!(await ab.open(url))) continue;
    await ab.waitFor("li.b_algo");
    const rows = await ab.evalArray<Row>(BING_EXTRACT, `read bing results for ${q}`);
    posts.push(...parseBingResults(rows).slice(0, max));
  }

  // 2) Bing News — recency + outside-crypto footprint.
  {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(`${term} meme`)}&setlang=en`;
    if (await ab.open(url)) {
      await ab.waitFor(".news-card, article");
      const rows = await ab.evalArray<Row>(BING_NEWS_EXTRACT, `read bing news for ${term}`);
      for (const r of rows) {
        const text = [r.title, r.snippet].filter(Boolean).join(" — ").trim();
        if (text) posts.push({ text: text.slice(0, 240), platform: "news" });
      }
    }
  }

  // 3) old.reddit — community talk (now clears the challenge with stealth flags).
  {
    const url = `https://old.reddit.com/search?q=${encodeURIComponent(`${term} ${symbol ?? ""}`.trim())}&sort=new`;
    if (await ab.open(url)) {
      await ab.waitFor(".search-result-link");
      const rows = await ab.evalArray<{ title: string; author: string }>(OLD_REDDIT_EXTRACT, "read reddit results");
      for (const r of rows.filter((x) => x.title).slice(0, 15)) {
        posts.push({ text: r.title.slice(0, 240), author: r.author || undefined, platform: "reddit" });
      }
    }
  }

  // 4) Brave — diverse web/social result set (stealth flags clear the captcha).
  {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(`"${term}" meme`)}`;
    if (await ab.open(url)) {
      await ab.waitFor(".snippet");
      const rows = await ab.evalArray<Row>(BRAVE_EXTRACT, `read brave for ${term}`);
      for (const r of rows) {
        const text = [r.title, r.snippet].filter(Boolean).join(" — ").trim();
        if (text) posts.push({ text: text.slice(0, 240), platform: platformFromUrl(r.href || "") });
      }
    }
  }

  // 5) DuckDuckGo (html) — surfaces tiktok/youtube/x links (now reachable).
  {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${term} meme`)}`;
    if (await ab.open(url)) {
      await ab.waitFor(".result");
      const rows = await ab.evalArray<Row>(DDG_EXTRACT, `read duckduckgo for ${term}`);
      posts.push(...parseDdgResults(rows).slice(0, max));
    }
  }

  onAction?.(`dive done — ${posts.length} posts collected`);
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

  // 1) Google News RSS (reliable) — real-world / news footprint.
  for (const q of [`${term} meme`, coin.symbol ? `${coin.symbol} coin` : ""].filter(Boolean)) {
    const news = await fetchGoogleNews(q);
    if (news.length) {
      posts.push(...news);
      platforms.add("news");
    }
  }

  // 2) Wikipedia (reliable) — a real, non-crypto article = strong outside-crypto signal.
  const wiki = await fetchWikipedia(term);
  if (wiki.matched && !wiki.isCrypto && wiki.title) {
    posts.push({ text: `Wikipedia: ${wiki.title} — ${wiki.snippet ?? ""}`.slice(0, 240), platform: "wikipedia" });
    platforms.add("wikipedia");
  }

  // 3) Social/search via real browser (opt-in). Primary driver: agent-browser
  //    (fast Rust CLI; streams to the dashboard RESEARCH CAM). Playwright stays
  //    as the automatic fallback when the CLI is not installed.
  if (opts.useBrowser) {
    const max = opts.maxPerQuery ?? 8;
    let collected = false;
    if (opts.driver !== "playwright" && (await AgentBrowser.available())) {
      try {
        for (const p of await collectViaAgentBrowser(term, coin.symbol, max, opts.onAction)) {
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

  return { mint: coin.mint, symbol: coin.symbol, name: coin.name, query: term, posts, platforms: [...platforms], links: [], fetchedAt: now };
}
