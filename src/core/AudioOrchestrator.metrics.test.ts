import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  Audio: {
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    getState: vi.fn(async () => ({ playing: false, positionMs: 0 })),
    setAutoMixMode: vi.fn(async () => {}),
    extractAndPlay: vi.fn(async () => ({ duration: 200, description: "", playing: true, loading: false })),
    setQueue: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
  },
  Auth: { playSpotify: vi.fn(), spotifyRequest: vi.fn(async () => ({ data: {} })) },
}));
vi.mock("../native", () => ({ isNative: true, Audio: mocks.Audio, Auth: mocks.Auth }));
vi.mock("./DiscoveryEngine", () => ({ recordListening: vi.fn(async () => {}) }));
vi.mock("./db", () => ({ db: { settings: { get: vi.fn(async () => undefined), put: vi.fn(async () => {}) } } }));
import { AudioOrchestrator } from "./AudioOrchestrator";
import { clearSamples, readSamples } from "./PlaybackMetrics";
import type { QueueItem } from "./types";

const track: QueueItem = { id: "yt:a", videoId: "abcdefghijk", source: "youtube", title: "A", artist: "B", duration: 200, tags: [] };
beforeEach(() => {
  vi.clearAllMocks();
  clearSamples();
});
afterEach(() => vi.useRealTimers());

describe("tap-to-playback metrics", () => {
  it("records one successful sample when the engine confirms playback", async () => {
    const player = new AudioOrchestrator();
    await player.playList([track, { ...track, id: "yt:b" }]);
    expect(readSamples()).toHaveLength(1);
    expect(readSamples()[0]).toMatchObject({ source: "youtube", ok: true });
  });
  it("records the provider error code for a failed selection", async () => {
    mocks.Audio.extractAndPlay.mockRejectedValueOnce(Object.assign(new Error("Bloqueado"), { code: "AUDIO_NOT_FOUND" }));
    const player = new AudioOrchestrator();
    await player.playList([track]);
    expect(readSamples()).toEqual([expect.objectContaining({ ok: false, code: "AUDIO_NOT_FOUND" })]);
  });
  it("does not credit a selection the user paused while loading", async () => {
    let finish!: (value: { duration: number; description: string; playing: boolean; loading: boolean }) => void;
    mocks.Audio.extractAndPlay.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const player = new AudioOrchestrator();
    const loading = player.playList([track]);
    await Promise.resolve();
    await player.pause();
    finish({ duration: 200, description: "", playing: true, loading: false });
    await loading;
    expect(readSamples()).toEqual([]);
  });
});
