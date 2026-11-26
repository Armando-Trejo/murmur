import { beforeEach, describe, expect, it } from "vitest";
import { guestModeOn, judgeHistory, setGuestMode } from "./tasteGuard";
import { tasteProfile } from "./autoMixes";
import type { HistoryEntry, QueueItem } from "./types";

// Node has no localStorage: a small in-memory one for «Modo invitado».
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 18);
const song = (id: string, artist: string, over: Partial<QueueItem> = {}): QueueItem => ({
  id, source: "youtube", title: id, artist, duration: 200, tags: [], videoId: id, ...over,
});
const play = (trackId: string, daysAgo: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  trackId, at: NOW - daysAgo * DAY, seconds: 180, skipped: false, ...over,
});

// The owner: King Gizzard every day, saved songs of Soda Stereo.
const library = [
  song("kg1", "King Gizzard & The Lizard Wizard"),
  song("kg2", "King Gizzard & The Lizard Wizard"),
  song("soda", "Soda Stereo", { saved: true }),
  song("bb", "Bad Bunny"),
  song("cumbia", "Los Ángeles Azules"),
  song("cumbia2", "Los Ángeles Azules"),
  song("idles", "IDLES"),
];
const owner = [0, 1, 2, 3, 4].flatMap((d) => [play("kg1", d), play("kg2", d + 0.2)]);

describe("taste guard", () => {
  beforeEach(() => localStorage.clear());

  it("a one-off request outside your taste does not teach anything", () => {
    // A friend asked for Bad Bunny three times in one evening.
    const history = [...owner, play("bb", 0.1), play("bb", 0.12), play("bb", 0.14)];
    const verdict = judgeHistory(history, library, { now: NOW });
    expect(verdict.trusted.some((e) => e.trackId === "bb")).toBe(false);
    expect(verdict.outsiders.has("bad bunny")).toBe(true);
    expect(tasteProfile(history, library, {}).get("bad bunny")).toBeUndefined();
  });

  it("coming back to an artist on different days makes it a new taste", () => {
    const history = [...owner, play("idles", 5), play("idles", 3), play("idles", 1)];
    const verdict = judgeHistory(history, library, { now: NOW });
    expect(verdict.established.has("idles")).toBe(true);
    expect(verdict.trusted.filter((e) => e.trackId === "idles")).toHaveLength(3);
  });

  it("two different songs on two days also count as a new taste", () => {
    const history = [...owner, play("cumbia", 2), play("cumbia2", 0.5)];
    expect(judgeHistory(history, library, { now: NOW }).established.has("los angeles azules")).toBe(true);
  });

  it("saving a song is explicit: it counts from the first listen", () => {
    const saved = library.map((t) => (t.id === "bb" ? { ...t, saved: true } : t));
    const verdict = judgeHistory([...owner, play("bb", 0)], saved, { now: NOW });
    expect(verdict.trusted.some((e) => e.trackId === "bb")).toBe(true);
  });

  it("MURMUR's own recommendations always count (that is how new tastes are found)", () => {
    const verdict = judgeHistory([...owner, play("idles", 0)], library, { now: NOW, suggested: { idles: 1 } });
    expect(verdict.trusted.some((e) => e.trackId === "idles")).toBe(true);
  });

  it("guest mode never teaches, even on many days", () => {
    const history = [...owner, ...[0, 1, 2, 3].map((d) => play("bb", d, { guest: true }))];
    const verdict = judgeHistory(history, library, { now: NOW });
    expect(verdict.established.has("bad bunny")).toBe(false);
    expect(verdict.trusted.some((e) => e.trackId === "bb")).toBe(false);
  });

  it("guest mode turns itself off", () => {
    setGuestMode(true, NOW);
    expect(guestModeOn(NOW + 60_000)).toBe(true);
    expect(guestModeOn(NOW + 4 * 3_600_000)).toBe(false);
    setGuestMode(false);
    expect(guestModeOn(NOW)).toBe(false);
  });

  it("your usual artists keep counting, skips included", () => {
    const history = [...owner, play("kg1", 0, { seconds: 5, skipped: true })];
    expect(judgeHistory(history, library, { now: NOW }).trusted).toHaveLength(history.length);
  });
});
