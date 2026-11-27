import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./magicShuffle", () => ({
  magicPicks: async () => [
    { id: "yt:1", source: "youtube", title: "Bailarina (Live)", artist: "Miranda!", duration: 200, tags: [] },
    { id: "yt:2", source: "youtube", title: "Perfecta", artist: "Miranda!", duration: 200, tags: [] },
  ],
}));
import { continuationPicks, habitsAfter, spread } from "./continuation";
import { bestSong, oncePerSong, youtubeUnderstood } from "./VoiceCommandRouter";
import type { HistoryEntry, QueueItem } from "./types";

const song = (id: string, title: string, artist = "Miranda!"): QueueItem =>
  ({ id, source: "youtube", videoId: id.padEnd(11, "x"), title, artist, duration: 200, tags: [] });

const memory = new Map<string, string>();
globalThis.localStorage ??= { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k), clear: () => memory.clear(), key: () => null, length: 0 } as Storage;
beforeEach(() => localStorage.clear());

describe("music never stops", () => {
  it("continues with related and recent songs, never another version of one already queued", async () => {
    const queue = [song("a", "Bailarina")];
    const picks = await continuationPicks(queue, queue[0], 3, async () => [song("r", "Don", "Miranda!"), song("b", "Bailarina")]);
    expect(picks.map((p) => p.title).sort()).toEqual(["Don", "Perfecta"]);
    expect(picks.every((p) => p.smart && p.continuation)).toBe(true);
  });
  it("a new selection avoids what it suggested before", async () => {
    const queue = [song("a", "Bailarina")];
    const recent = async () => [song("r", "Don"), song("s", "Yo te diré"), song("t", "Mentía")];
    const first = await continuationPicks(queue, queue[0], 2, recent);
    const second = await continuationPicks(queue, queue[0], 2, recent, first);
    expect(second.some((t) => first.some((f) => f.title === t.title))).toBe(false);
  });
  it("learns what the owner plays after a song (not as a guest, not skipped)", () => {
    const a = song("a", "Bailarina"), b = song("b", "Don"), c = song("c", "Perfecta"), d = song("d", "Otra", "Otro");
    const lib = new Map([a, b, c, d].map((t) => [t.id, t]));
    const at = (n: number) => 1_000_000 + n * 240_000;
    const history: HistoryEntry[] = [
      { trackId: "a", at: at(0), seconds: 200, skipped: false }, { trackId: "b", at: at(1), seconds: 200, skipped: false },
      { trackId: "a", at: at(10), seconds: 200, skipped: false }, { trackId: "b", at: at(11), seconds: 200, skipped: false },
      { trackId: "a", at: at(20), seconds: 200, skipped: false }, { trackId: "c", at: at(21), seconds: 5, skipped: true },
      { trackId: "a", at: at(30), seconds: 200, skipped: false }, { trackId: "d", at: at(31), seconds: 200, skipped: false, guest: true },
    ];
    expect(habitsAfter(a, history, lib).map((h) => [h.track.title, h.times])).toEqual([["Don", 4]]);
  });
  it("never puts the same artist twice in a row when there is another choice", () => {
    const list = [song("1", "A1", "X"), song("2", "A2", "X"), song("3", "B1", "Y"), song("4", "A3", "X"), song("5", "B2", "Y")];
    const out = spread(list, 5, 2);
    for (let i = 1; i < out.length; i++) expect(out[i].artist === out[i - 1].artist && out.length > 2 ? out.slice(i).some((t) => t.artist !== out[i].artist) : false).toBe(false);
    expect(out.filter((t) => t.artist === "X")).toHaveLength(2);
  });
  it("plays the studio recording a voice request names, not a live cut", () => {
    const list = [song("l", "Bailarina (En Vivo)"), song("s", "Bailarina"), song("o", "Otra")];
    expect(bestSong(list, "bailarina", "miranda")?.id).toBe("s");
    expect(bestSong(list, "cancion inexistente")).toBeUndefined();
  });
  it("keeps one entry per song in a voice mix", () =>
    expect(oncePerSong([song("a", "Don"), song("b", "Don (Official Video)"), song("c", "Perfecta")]).map((t) => t.id)).toEqual(["a", "c"]));
});

describe("voice trusts what YouTube understood", () => {
  const chop = song("chop", "Chop Suey!", "System Of A Down");
  const video = { ...song("vid", "System Of A Down - Chop Suey! (Official HD Video)", "systemofadownVEVO") };
  it("is sure when YouTube and YouTube Music agree, even if the words look nothing alike («iwachu»)", () =>
    expect(youtubeUnderstood([song("x", "I Want You"), chop], [video])).toEqual({ track: chop, score: 0.93 }));
  it("looks past a lyric video to the official one («iwachu» as YouTube really answers)", () => {
    const lyric = song("lyr", "System of a Down - Iwachu (Subtitulada en español | Lyrics)", "Artista por identificar");
    expect(youtubeUnderstood([chop, song("t", "Toxicity", "System Of A Down")], [lyric, video], "iwachu")?.track).toBe(chop);
  });
  it("takes YouTube's official upload when YouTube Music did not answer the same", () => {
    const found = youtubeUnderstood([song("x", "I Want You", "Someone")], [video]);
    expect(found?.score).toBe(0.86);
    expect(found?.track).toMatchObject({ title: "Chop Suey!", artist: "System Of A Down" });
  });
  it("a vague request plays YouTube's first video when it shares heard words («intro 2 de naruto»)", () => {
    const opening = song("nar", "Naruto Shippuden Opening 2 | Distance", "AnimeFan");
    expect(youtubeUnderstood([song("d", "Distance", "Long Shot Party")], [opening], "intro 2 de naruto")).toMatchObject({ track: { id: "nar", artist: "Naruto Shippuden Opening 2" }, score: 0.76 });
  });
  it("YouTube's first video with nothing in common with what was said is only offered", () =>
    expect(youtubeUnderstood([], [song("z", "Some Vlog", "Someone")], "intro 2 de naruto")?.score).toBeLessThan(0.7));
  it("without YouTube's own answer, nothing is trusted (MURMUR offers options instead of guessing)", () =>
    expect(youtubeUnderstood([chop], [])).toBeUndefined());
});
