import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ youtubeLyrics: vi.fn(), store: new Map<string, unknown>() }));
vi.mock("../native", () => ({ isNative: true, Audio: {}, Auth: { youtubeLyrics: mocks.youtubeLyrics } }));
vi.mock("./db", () => ({
  db: {
    settings: {
      get: async (key: string) => (mocks.store.has(key) ? { key, value: mocks.store.get(key) } : undefined),
      put: async ({ key, value }: { key: string; value: unknown }) => void mocks.store.set(key, value),
    },
  },
}));

import { getLyrics, lyricsQuery, parseSyncedLyrics, pickLrclib } from "./DiscoveryEngine";
import type { QueueItem } from "./types";

const track = (title: string, artist: string, duration = 215): QueueItem => ({
  id: "yt:" + title, source: "youtube", title, artist, duration, tags: [], videoId: "abcdefghijk",
});

beforeEach(() => {
  mocks.store.clear();
  mocks.youtubeLyrics.mockReset();
  vi.unstubAllGlobals();
});

describe("lyrics lookup", () => {
  it("cleans upload titles and provider artist names", () => {
    expect(lyricsQuery(track("Caifanes - Afuera (Official Video)", "CaifanesVEVO"))).toEqual({ title: "Afuera", artist: "Caifanes" });
    expect(lyricsQuery(track("Tití Me Preguntó (feat. Someone)", "Bad Bunny - Topic"))).toEqual({ title: "Tití Me Preguntó", artist: "Bad Bunny" });
    expect(lyricsQuery(track("Hasta la Raíz: Remastered", "Natalia Lafourcade, Otra")).artist).toBe("Natalia Lafourcade");
    expect(lyricsQuery(track("Soda Stereo - De Música Ligera", "Artista por identificar")))
      .toEqual({ title: "De Música Ligera", artist: "Soda Stereo" });
  });

  it("prefers the synced entry with the right artist and length", () => {
    const entries = [
      { trackName: "Afuera", artistName: "Otro", duration: 215, syncedLyrics: "[00:01.00]x" },
      { trackName: "Afuera", artistName: "Caifanes", duration: 300, plainLyrics: "a" },
      { trackName: "Afuera", artistName: "Caifanes", duration: 216, syncedLyrics: "[00:01.00]y" },
    ];
    expect(pickLrclib(entries, "Afuera", "Caifanes", 215)).toBe(entries[2]);
    expect(pickLrclib([{ trackName: "Otra canción", artistName: "Caifanes", plainLyrics: "z" }], "Afuera", "Caifanes", 215)).toBeUndefined();
  });

  it("parses multi-timestamp LRC lines in order", () => {
    expect(parseSyncedLyrics("[00:10.00][00:30.50]Coro\n[00:20.00]Verso")).toEqual([
      { time: 10, text: "Coro" }, { time: 20, text: "Verso" }, { time: 30.5, text: "Coro" },
    ]);
  });

  it("falls back to fuzzy search and then to YouTube Music lyrics", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/get")) return new Response("", { status: 404 });
      return new Response(JSON.stringify(url.includes("track_name")
        ? [{ trackName: "Afuera", artistName: "Caifanes", duration: 214, syncedLyrics: "[00:05.00]Hola" }]
        : []), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const synced = await getLyrics(track("Afuera", "Caifanes"));
    expect(synced.timed).toEqual([{ time: 5, text: "Hola" }]);
    expect(synced.source).toBe("LRCLIB");

    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/api/get") ? new Response("", { status: 404 }) : new Response("[]", { status: 200 })));
    mocks.youtubeLyrics.mockResolvedValue({ found: true, text: "Letra completa", source: "LyricFind" });
    const plain = await getLyrics(track("Rara", "Banda"));
    expect(mocks.youtubeLyrics).toHaveBeenCalledWith({ videoId: "abcdefghijk" });
    expect(plain).toMatchObject({ plain: "Letra completa", source: "YouTube Music · LyricFind" });
  });

  it("reports a connection problem only when no service answered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    mocks.youtubeLyrics.mockRejectedValue(new Error("offline"));
    await expect(getLyrics(track("Sin red", "Nadie"))).rejects.toThrow(/conectar/);
  });
});
