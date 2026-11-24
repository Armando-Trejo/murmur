import { describe, expect, it, vi } from "vitest";
import { backdropTone, dominantColor } from "./palette";
import { activeLyricIndex, lyricScrollTarget } from "./lyrics";
import { computeInsights, formatListening, greeting, hourRange, listenedSeconds } from "./insights";
import { SelectionTimer, percentile, readSamples, recordSample, sanitizeCode, summarize, type PlaybackSample } from "./PlaybackMetrics";
import { pushRecent, removeRecent, validRecent } from "./recentSearches";
import type { HistoryEntry, QueueItem } from "./types";

const pixels = (...colors: [number, number, number, number?][]) =>
  colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]);

describe("artwork palette", () => {
  it("prefers the saturated artwork colour over black bars and white text", () => {
    const data = pixels(
      ...Array(40).fill([0, 0, 0]),
      ...Array(20).fill([250, 250, 250]),
      ...Array(18).fill([150, 60, 230]),
    );
    const [r, g, b] = dominantColor(data)!;
    expect(b).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(g);
  });
  it("ignores transparent pixels and returns nothing for an empty sample", () => {
    expect(dominantColor(pixels([255, 0, 0, 0], [0, 255, 0, 10]))).toBeUndefined();
    expect(dominantColor([])).toBeUndefined();
  });
  it("keeps backdrop tones dark enough for white text", () => {
    for (const color of [[255, 255, 255], [250, 230, 40], [5, 5, 5], [120, 200, 255]] as const) {
      const tone = backdropTone([...color]);
      const lightness = (Math.max(...tone) + Math.min(...tone)) / 2 / 255;
      expect(lightness).toBeGreaterThanOrEqual(0.19);
      expect(lightness).toBeLessThanOrEqual(0.41);
    }
  });
});

describe("synced lyrics", () => {
  const lines = [{ time: 5, text: "a" }, { time: 9, text: "b" }, { time: 9, text: "b2" }, { time: 20, text: "c" }];
  it("finds the line being sung", () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1);
    expect(activeLyricIndex(lines, 5)).toBe(0);
    expect(activeLyricIndex(lines, 8.99)).toBe(0);
    expect(activeLyricIndex(lines, 9)).toBe(2);
    expect(activeLyricIndex(lines, 400)).toBe(3);
    expect(activeLyricIndex([], 10)).toBe(-1);
    expect(activeLyricIndex(lines, Number.NaN)).toBe(-1);
  });
  it("anchors the active line slightly above the centre", () => {
    expect(lyricScrollTarget(500, 40, 400)).toBe(368);
    expect(lyricScrollTarget(10, 40, 400)).toBe(0);
  });
});

describe("listening insights", () => {
  const day = 86_400_000;
  const now = new Date(2026, 10, 24, 21, 0).getTime();
  const track = (id: string, artist: string, source: "spotify" | "youtube" = "youtube", duration = 200): QueueItem =>
    ({ id, title: id, artist, source, duration, tags: [] });
  const tracks = new Map([
    ["a", track("a", "Ana, Invitado", "spotify")],
    ["b", track("b", "Bruno")],
    ["c", track("c", "Artista por identificar")],
  ]);
  const entry = (trackId: string, at: number, seconds: number, skipped = false): HistoryEntry => ({ trackId, at, seconds, skipped });
  const history = [
    entry("a", now - 1000, 180),
    entry("a", now - 2000, 900),
    entry("b", now - day, 120),
    entry("b", now - 2 * day, 10, true),
    entry("c", now - 2 * day, 100),
    entry("b", now - 3 * day, 60),
    entry("a", now - 40 * day, 200),
  ];
  it("summarises time, plays, artists and sources within the window", () => {
    const result = computeInsights(history, tracks, now, 7);
    expect(result.totalSeconds).toBe(180 + 200 + 120 + 10 + 100 + 60);
    expect(result.plays).toBe(5);
    expect(result.topArtists[0]).toMatchObject({ name: "Ana", plays: 2 });
    expect(result.topArtists.map(a => a.name)).not.toContain("Artista por identificar");
    expect(result.sources.spotify).toBe(380);
    expect(result.sources.youtube).toBe(290);
    expect(result.skipRate).toBeCloseTo(1 / 6);
    expect(result.topTracks[0].trackId).toBe("a");
  });
  it("counts a streak of consecutive days and the last seven days", () => {
    const result = computeInsights(history, tracks, now, null);
    expect(result.streak).toBe(4);
    expect(result.daily).toHaveLength(7);
    expect(result.daily[6]).toMatchObject({ today: true, seconds: 380 });
    expect(result.daily[6].label).toBe("M");
    expect(result.totalSeconds).toBeGreaterThan(computeInsights(history, tracks, now, 7).totalSeconds);
  });
  it("keeps a streak alive until the end of today", () => {
    const yesterdayOnly = [entry("b", now - day, 120), entry("b", now - 2 * day, 120)];
    expect(computeInsights(yesterdayOnly, tracks, now, 7).streak).toBe(2);
    expect(computeInsights([entry("b", now - 3 * day, 120)], tracks, now, 7).streak).toBe(0);
  });
  it("bounds stored positions by the track length", () => {
    expect(listenedSeconds(entry("a", now, 5000), tracks.get("a"))).toBe(200);
    expect(listenedSeconds(entry("x", now, Number.NaN))).toBe(0);
  });
  it("formats durations and greetings in Spanish", () => {
    expect(formatListening(0)).toBe("0 min");
    expect(formatListening(20)).toBe("< 1 min");
    expect(formatListening(125 * 60)).toBe("2 h 5 min");
    expect(formatListening(3600)).toBe("1 h");
    expect(hourRange(23)).toBe("23–00 h");
    expect(greeting(7)).toBe("Buenos días");
    expect(greeting(15)).toBe("Buenas tardes");
    expect(greeting(2)).toBe("Buenas noches");
  });
});

describe("playback metrics", () => {
  const storage = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  };
  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 0.5)).toBeUndefined();
    expect(percentile([300, 100, 200], 0.5)).toBe(200);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.95)).toBe(100);
  });
  it("summarises per provider and keeps only sanitized codes", () => {
    const store = storage();
    recordSample({ source: "youtube", ms: 812.4, at: 1, ok: true }, store);
    recordSample({ source: "youtube", ms: 4000, at: 2, ok: false, code: "audio-not found: https://x" }, store);
    recordSample({ source: "spotify", ms: 300, at: 3, ok: true }, store);
    const samples = readSamples(store);
    expect(samples[0].ms).toBe(812);
    expect(samples[1].code).toBe("AUDIONOTFOUNDHTTPSX");
    const summary = summarize(samples);
    expect(summary.youtube).toMatchObject({ count: 2, failures: 1, p50: 812 });
    expect(summary.spotify).toMatchObject({ count: 1, failures: 0, p50: 300, p95: 300 });
    expect(sanitizeCode(undefined)).toBeUndefined();
  });
  it("credits only the newest selection and ignores superseded confirmations", () => {
    let clock = 0;
    const record = vi.fn();
    const timer = new SelectionTimer(() => clock, record);
    timer.start("a", "youtube");
    clock = 100;
    timer.start("b", "spotify");
    clock = 150;
    timer.observe({ queueId: "a", playing: true, loading: false });
    expect(record).not.toHaveBeenCalled();
    timer.start("c", "youtube");
    clock = 400;
    timer.observe({ queueId: "c", playing: false, loading: true });
    clock = 900;
    timer.observe({ queueId: "c", playing: true, loading: false });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ source: "youtube", ms: 750, ok: true } satisfies Partial<PlaybackSample>);
    timer.observe({ queueId: "c", playing: true, loading: false });
    expect(record).toHaveBeenCalledTimes(1);
  });
  it("records failures and stops measuring when cancelled", () => {
    let clock = 0;
    const record = vi.fn();
    const timer = new SelectionTimer(() => clock, record);
    timer.start("a", "spotify");
    clock = 50;
    timer.observe({ queueId: "a", playing: false, loading: false, error: "x", errorCode: "SPOTIFY_ENGINE_FAILED" });
    expect(record.mock.calls[0][0]).toMatchObject({ ok: false, code: "SPOTIFY_ENGINE_FAILED", ms: 50 });
    timer.start("b", "youtube");
    timer.cancel();
    timer.observe({ queueId: "b", playing: true, loading: false });
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe("recent searches", () => {
  it("keeps the newest unique queries first", () => {
    let list: string[] = [];
    for (const query of ["Misfits", "  daft   punk ", "a", "misfits", "Rosalía"]) list = pushRecent(list, query);
    expect(list).toEqual(["Rosalía", "misfits", "daft punk"]);
    expect(pushRecent(list, "x")).toBe(list);
    expect(removeRecent(list, "misfits")).toEqual(["Rosalía", "daft punk"]);
    expect(pushRecent(Array.from({ length: 8 }, (_, i) => "q" + i), "nuevo")).toHaveLength(8);
  });
  it("rejects malformed stored values", () => {
    expect(validRecent("x")).toEqual([]);
    expect(validRecent(["ok", 3, null, "bien"])).toEqual(["ok", "bien"]);
  });
});
