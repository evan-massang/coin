import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AlertDispatcher } from "./dispatcher.js";
import { buildLinks, decisionToAlert } from "./templates.js";
import { SettingsStore } from "../store/settingsStore.js";
import { openDb, type DB } from "../store/db.js";
import type { Decision, Verdict } from "../types.js";
import { emptyScores } from "../types.js";
import type { Notifier } from "./desktopNotifier.js";
import type { SoundPlayer } from "./sound.js";

class FakeNotifier implements Notifier {
  calls: Array<{ title: string; message: string }> = [];
  notify(title: string, message: string): void {
    this.calls.push({ title, message });
  }
}
class FakeSound implements SoundPlayer {
  plays = 0;
  play(): void {
    this.plays++;
  }
}

function decision(verdict: Verdict, conviction: number): Decision {
  return {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "WIF",
    name: "dogwifhat",
    verdict,
    conviction,
    scores: emptyScores(),
    reasons: ["clean authorities", "buyer velocity rising"],
    flags: [],
    caps: [],
    at: 123,
  };
}

let db: DB;
let settings: SettingsStore;
let notifier: FakeNotifier;
let sound: FakeSound;
let dispatcher: AlertDispatcher;
const journalled: Decision[] = [];

beforeEach(() => {
  db = openDb(":memory:");
  settings = new SettingsStore(db);
  settings.update({ desktopNotifications: true, sound: true, minConviction: 60 });
  notifier = new FakeNotifier();
  sound = new FakeSound();
  journalled.length = 0;
  dispatcher = new AlertDispatcher({
    settings,
    notifier,
    sound,
    journal: (d) => {
      journalled.push(d);
      return 1;
    },
  });
});

afterEach(() => db.close());

describe("alert links", () => {
  it("builds correct Phantom / Jupiter / DexScreener / RugCheck URLs", () => {
    const mint = "ABC123";
    const links = buildLinks(mint);
    expect(links.phantom).toBe("https://phantom.com/tokens/solana/ABC123");
    expect(links.jupiter).toBe("https://jup.ag/swap/SOL-ABC123");
    expect(links.dexscreener).toBe("https://dexscreener.com/solana/ABC123");
    expect(links.rugcheck).toBe("https://rugcheck.xyz/tokens/ABC123");
  });

  it("decisionToAlert carries verdict, conviction, reasons and links", () => {
    const a = decisionToAlert(decision("BUY_STRONG", 88));
    expect(a.kind).toBe("BUY_STRONG");
    expect(a.conviction).toBe(88);
    expect(a.reasons).toContain("clean authorities");
    expect(a.links.jupiter).toContain("jup.ag");
  });
});

describe("dispatch loud/quiet gating (§1.5)", () => {
  it("journals every decision, including quiet ones", () => {
    dispatcher.dispatch(decision("AVOID", 0));
    dispatcher.dispatch(decision("BUY_STRONG", 80));
    expect(journalled).toHaveLength(2);
  });

  it("BUY_STRONG over min conviction notifies + plays sound", () => {
    dispatcher.dispatch(decision("BUY_STRONG", 80));
    expect(notifier.calls).toHaveLength(1);
    expect(sound.plays).toBe(1);
    expect(notifier.calls[0]!.title).toMatch(/BUY_STRONG/);
  });

  it("BUY_SMALL under min conviction stays quiet", () => {
    dispatcher.dispatch(decision("BUY_SMALL", 50)); // < 60
    expect(notifier.calls).toHaveLength(0);
    expect(sound.plays).toBe(0);
  });

  it("AVOID / WATCH_ONLY / TOO_LATE never notify", () => {
    dispatcher.dispatch(decision("AVOID", 0));
    dispatcher.dispatch(decision("WATCH_ONLY", 45));
    dispatcher.dispatch(decision("TOO_LATE", 90));
    expect(notifier.calls).toHaveLength(0);
  });

  it("SELL_EXIT_NOW always notifies regardless of conviction", () => {
    dispatcher.dispatch(decision("SELL_EXIT_NOW", 5));
    expect(notifier.calls).toHaveLength(1);
  });

  it("respects desktopNotifications=false (sound can still play)", () => {
    settings.update({ desktopNotifications: false });
    dispatcher.dispatch(decision("BUY_STRONG", 90));
    expect(notifier.calls).toHaveLength(0);
    expect(sound.plays).toBe(1);
  });
});
