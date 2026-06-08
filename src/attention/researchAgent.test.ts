import { describe, it, expect } from "vitest";
import { platformFromUrl, decodeDdgHref, parseDdgResults, postsFromReddit, parseGoogleNewsRss, parseWikipediaSearch } from "./researchAgent.js";

describe("platformFromUrl", () => {
  it("maps domains to platforms", () => {
    expect(platformFromUrl("https://www.reddit.com/r/x/abc")).toBe("reddit");
    expect(platformFromUrl("https://www.tiktok.com/@u/video/1")).toBe("tiktok");
    expect(platformFromUrl("https://youtu.be/abc")).toBe("youtube");
    expect(platformFromUrl("https://x.com/u/status/1")).toBe("twitter");
    expect(platformFromUrl("https://example.org/blog")).toBe("web");
  });
});

describe("decodeDdgHref", () => {
  it("decodes the uddg redirect param", () => {
    expect(decodeDdgHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Ftiktok.com%2F%40a&rut=x")).toBe("https://tiktok.com/@a");
    expect(decodeDdgHref("//example.com/x")).toBe("https://example.com/x");
  });
});

describe("parseDdgResults", () => {
  it("turns result rows into platform-tagged posts", () => {
    const posts = parseDdgResults([
      { title: "Doggo meme blowing up", snippet: "everyone on tiktok", href: "//duckduckgo.com/l/?uddg=https%3A%2F%2Ftiktok.com%2Fx" },
      { title: "", snippet: "", href: "//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.com" }, // empty -> dropped
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0].platform).toBe("tiktok");
    expect(posts[0].text).toMatch(/Doggo/);
  });
});

describe("postsFromReddit", () => {
  it("extracts authored posts with ups + timestamp", () => {
    const json = { data: { children: [
      { data: { author: "alice", title: "this coin meme is funny", selftext: "lol", ups: 42, created_utc: 1_700_000_000 } },
      { data: { author: "[deleted]", title: "gm", selftext: "", ups: 1, created_utc: 1_700_000_100 } },
    ] } };
    const posts = postsFromReddit(json);
    expect(posts).toHaveLength(2);
    expect(posts[0].author).toBe("alice");
    expect(posts[0].reactions).toBe(42);
    expect(posts[0].at).toBe(1_700_000_000_000);
    expect(posts[1].author).toBeUndefined(); // [deleted] dropped
  });
});

describe("parseGoogleNewsRss", () => {
  it("extracts title + outlet + date from RSS items", () => {
    const xml = `<rss><channel>
      <item><title>How frogs became a meme - BBC</title><pubDate>Mon, 02 Jun 2026 10:00:00 GMT</pubDate><source url="https://bbc.com">BBC</source></item>
      <item><title>PEPE price prediction &amp; analysis - CoinDesk</title><pubDate>Tue, 03 Jun 2026 10:00:00 GMT</pubDate><source url="https://coindesk.com">CoinDesk</source></item>
    </channel></rss>`;
    const posts = parseGoogleNewsRss(xml);
    expect(posts).toHaveLength(2);
    expect(posts[0].platform).toBe("news");
    expect(posts[0].author).toBe("BBC");
    expect(posts[0].text).toMatch(/frogs became a meme/);
    expect(posts[1].text).toContain("&"); // &amp; decoded
    expect(posts[0].at).toBeGreaterThan(0);
  });
});

describe("parseWikipediaSearch", () => {
  it("flags a real non-crypto article as matched + not crypto", () => {
    const json = { query: { search: [{ title: "Pepe the Frog", snippet: "is a <b>comic</b> character and internet meme" }] } };
    const r = parseWikipediaSearch(json, "pepe");
    expect(r.matched).toBe(true);
    expect(r.isCrypto).toBe(false);
  });
  it("flags a crypto article as isCrypto", () => {
    const json = { query: { search: [{ title: "Dogecoin", snippet: "a cryptocurrency and meme coin on the blockchain" }] } };
    const r = parseWikipediaSearch(json, "dogecoin");
    expect(r.matched).toBe(true);
    expect(r.isCrypto).toBe(true);
  });
  it("no article ⇒ not matched", () => {
    expect(parseWikipediaSearch({ query: { search: [] } }, "zzqxnovel").matched).toBe(false);
  });
});
