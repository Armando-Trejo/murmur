import { describe, it, expect, vi } from "vitest";
vi.mock("../native", () => ({
  isNative: true,
  Audio: {
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    extractAndPlay: vi.fn(async () => ({ duration: 200, description: "" })),
    setQueue: vi.fn(async () => {}),
    prefetchAudio: vi.fn(async () => {}),
  },
  Auth: { spotifyRequest: vi.fn(async () => ({ data: {} })) },
  Voice: {},
}));
vi.mock("./DiscoveryEngine", () => ({ recordListening: vi.fn(async () => {}) }));
vi.mock("./db", () => ({ db: { settings: { get: vi.fn(async () => undefined), put: vi.fn(async () => {}) } } }));
import { AudioOrchestrator } from "./AudioOrchestrator";
import { interleaveMagic } from "./magicShuffle";
import type { QueueItem } from "./types";

const song = (n: number): QueueItem => ({ id: "yt:" + n, videoId: String(n).padStart(11, "x"), source: "youtube", title: "T" + n, artist: "A" + n, duration: 100, tags: [] });

describe("Aleatorio mágico", () => {
  it("intercalates one related song after every three", () => {
    const upcoming = [1, 2, 3, 4, 5, 6].map(song);
    const picks = [song(90), song(91)].map((t) => ({ ...t, smart: true }));
    expect(interleaveMagic(upcoming, picks).map((t) => t.id)).toEqual(["yt:1", "yt:2", "yt:3", "yt:90", "yt:4", "yt:5", "yt:6", "yt:91"]);
  });

  it("cycles shuffle → magic → off, restoring order and removing added songs", async () => {
    const p = new AudioOrchestrator();
    await p.playList([0, 1, 2, 3, 4, 5, 6].map(song));
    const original = p.getSnapshot().queue.slice(1).map((t) => t.id);

    expect(await p.cycleShuffle(async () => [])).toBe("Aleatorio activado");
    expect(p.getSnapshot().shuffleMode).toBe("on");
    expect(p.getSnapshot().queue.slice(1).map((t) => t.id)).not.toEqual(original);

    const message = await p.cycleShuffle(async () => [song(90), song(91)]);
    expect(message).toMatch(/agregué 2 canciones/);
    expect(p.getSnapshot().shuffleMode).toBe("magic");
    expect(p.getSnapshot().queue.filter((t) => t.smart)).toHaveLength(2);

    expect(await p.cycleShuffle(async () => [])).toBe("Aleatorio desactivado");
    expect(p.getSnapshot().shuffleMode).toBe("off");
    expect(p.getSnapshot().queue.some((t) => t.smart)).toBe(false);
    expect(p.getSnapshot().queue.slice(1).map((t) => t.id)).toEqual(original);
  });
});
