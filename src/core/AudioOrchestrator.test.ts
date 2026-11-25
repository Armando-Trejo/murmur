import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  Audio: {
    addListener: vi.fn(
      async (_name: string, _callback: (event: any) => void) => ({
        remove: async () => {},
      }),
    ),
    getState: vi.fn(async () => ({ playing: false, positionMs: 0 })),
    setAutoMixMode: vi.fn(async () => {}),
    extractAndPlay: vi.fn(async () => ({ duration: 200, description: "" })),
    setQueue: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    preloadNextStream: vi.fn(async () => {}),
    prefetchAudio: vi.fn(async () => {}),
    triggerManualMix: vi.fn(async () => {}),
    seekTo: vi.fn(async () => {}),
  },
  Auth: {
    playSpotify: vi.fn(async (_o: { uri: string }) => {}),
    spotifyRequest: vi.fn(async () => ({ data: {} })),
  },
  settings: { get: vi.fn(async () => undefined), put: vi.fn(async () => {}) },
  record: vi.fn(async () => {}),
}));
vi.mock("../native", () => ({
  isNative: true,
  Audio: mocks.Audio,
  Auth: mocks.Auth,
}));
vi.mock("./DiscoveryEngine", () => ({
  recordListening: mocks.record,
}));
vi.mock("./db", () => ({ db: { settings: mocks.settings } }));
import { AudioOrchestrator } from "./AudioOrchestrator";
import type { QueueItem } from "./types";
const a: QueueItem = {
  id: "yt:a",
  videoId: "abcdefghijk",
  source: "youtube",
  title: "A",
  artist: "Artist",
  duration: 200,
  tags: [],
};
const b: QueueItem = { ...a, id: "yt:b", title: "B" };
beforeEach(() => {
  mocks.Auth.spotifyRequest.mockReset().mockResolvedValue({ data: {} });
  mocks.Auth.playSpotify.mockReset().mockResolvedValue();
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.Audio.getState.mockResolvedValue({ playing: false, positionMs: 0 });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("AudioOrchestrator", () => {
  it("keeps a paused pending request from announcing playback later", async () => {
    let finish!: (value: {
      duration: number;
      description: string;
      playing: boolean;
      loading: boolean;
    }) => void;
    mocks.Audio.extractAndPlay.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const p = new AudioOrchestrator();
    const loading = p.playList([a]);
    await Promise.resolve();
    await p.pause();
    finish({ duration: 200, description: "", playing: true, loading: false });
    await loading;
    expect(p.getSnapshot().playing).toBe(false);
    expect(p.getSnapshot().loading).toBe(false);
    expect(p.getSnapshot().error).toBe("");
  });
  it("keeps integrated Spotify buffering truthful and forwards full metadata", async () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "murmur.spotifyVia" ? "spotify" : null), setItem: () => {}, removeItem: () => {} });
    const local = {
      deviceName: "MURMUR · Integrado",
      transport: "integrated",
      playing: false,
      loading: true,
    };
    mocks.Auth.playSpotify.mockResolvedValueOnce(local as any);
    const p = new AudioOrchestrator();
    const track = {
      ...a,
      id: "sp:one",
      source: "spotify" as const,
      spotifyUri: "spotify:track:" + "A".repeat(22),
    };
    await p.playList([track]);
    expect(mocks.Auth.playSpotify).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: track.spotifyUri,
        title: track.title,
        id: track.id,
      }),
    );
    expect(p.getSnapshot().playing).toBe(false);
    expect(p.getSnapshot().loading).toBe(true);
  });
  it("ignores late playback errors from a track that has already been replaced", async () => {
    const p = new AudioOrchestrator();
    await p.init();
    await p.playList([b]);
    const error = mocks.Audio.addListener.mock.calls.find(
      ([name]) => name === "onTrackError",
    )?.[1];
    error!({
      trackId: a.id,
      message: "Old source failed",
      code: "AUDIO_PLAYBACK_FAILED",
    });
    expect(p.current?.id).toBe(b.id);
    expect(p.getSnapshot().error).toBe("");
  });
  it("plays queued tracks in the order they were added, before the rest of the list", async () => {
    const p = new AudioOrchestrator();
    const c = { ...a, id: "yt:c", title: "C" };
    const d = { ...a, id: "yt:d", title: "D" };
    await p.playList([a, b]);
    p.enqueue(c);
    p.enqueue(d);
    expect(p.getSnapshot().queue.map((t) => t.title)).toEqual([a.title, "C", "D", "B"]);
    await p.next();
    p.enqueue({ ...a, id: "yt:e", title: "E" });
    expect(p.getSnapshot().queue.slice(p.getSnapshot().index).map((t) => t.title)).toEqual(["C", "D", "E", "B"]);
  });
  it("starts extraction when the first track was added to an empty queue", async () => {
    const p = new AudioOrchestrator();
    p.enqueue(a);
    await p.toggle();
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledWith(
      expect.objectContaining(a),
    );
    expect(mocks.Audio.resume).not.toHaveBeenCalled();
    expect(p.getSnapshot().playing).toBe(true);
  });
  it("resumes an already loaded track without extracting again", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a]);
    await p.pause();
    await p.toggle();
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledTimes(1);
    expect(mocks.Audio.resume).toHaveBeenCalledTimes(1);
  });
  it("retains the current track while upcoming tracks are reordered", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, b]);
    p.reorder([b, a]);
    expect(p.current?.id).toBe(a.id);
    expect(p.getSnapshot().index).toBe(1);
  });
  it("stops at the end without restarting the final track", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a]);
    await p.next(false);
    expect(p.getSnapshot().playing).toBe(false);
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ id: a.id }),
      0,
      false,
    );
  });
  it("does not overwrite a newer queue when old extraction completes late", async () => {
    let release!: (value: { duration: number; description: string }) => void;
    mocks.Audio.extractAndPlay.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const p = new AudioOrchestrator();
    const old = p.playList([a]);
    await Promise.resolve();
    await p.playList([b]);
    release({ duration: 999, description: "Old" });
    await old;
    expect(p.current?.id).toBe(b.id);
    expect(p.current?.duration).toBe(200);
  });
  it("resumes the natively advanced track without restarting extraction", async () => {
    const p = new AudioOrchestrator();
    await p.init();
    await p.playList([a, b]);
    const changed = mocks.Audio.addListener.mock.calls.find(
      ([name]) => name === "onNativeTrackChanged",
    )?.[1];
    expect(changed).toBeDefined();
    changed!({ id: b.id });
    await p.pause();
    await p.toggle();
    expect(p.current?.id).toBe(b.id);
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledTimes(1);
    expect(mocks.Audio.resume).toHaveBeenCalledTimes(1);
  });
  it("persists a chosen mix mode and applies it natively", async () => {
    const p = new AudioOrchestrator();
    await p.setMode("dj");
    expect(mocks.settings.put).toHaveBeenCalledWith({
      key: "mixMode",
      value: "dj",
    });
    expect(mocks.Audio.setAutoMixMode).toHaveBeenCalledWith({ mode: "dj" });
  });
  it("starts YouTube without asking a disconnected Spotify account for a token", async () => {
    mocks.Auth.spotifyRequest.mockRejectedValue(new Error("Spotify 403"));
    const p = new AudioOrchestrator();
    await p.playList([a]);
    expect(mocks.Auth.spotifyRequest).not.toHaveBeenCalled();
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledWith(
      expect.objectContaining(a),
    );
    expect(p.getSnapshot().error).toBe("");
  });
  it("does not block YouTube when pausing the previous Spotify device hangs", async () => {
    const p = new AudioOrchestrator();
    await p.playList([
      {
        ...a,
        id: "sp:track",
        source: "spotify",
        spotifyUri: "spotify:track:1234567890abcdef123456",
      },
    ]);
    mocks.Auth.spotifyRequest.mockImplementation(() => new Promise(() => {}));
    await p.playList([a]);
    expect(p.current?.source).toBe("youtube");
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledWith(
      expect.objectContaining(a),
    );
  });
  it("keeps buffering visible instead of claiming audio is already playing", async () => {
    const buffered = {
      duration: 200,
      description: "",
      playing: false,
      loading: true,
    };
    mocks.Audio.extractAndPlay.mockResolvedValueOnce(buffered);
    const p = new AudioOrchestrator();
    await p.playList([a]);
    expect(p.getSnapshot().loading).toBe(true);
    expect(p.getSnapshot().playing).toBe(false);
  });
  it("extracts a fresh URL when retrying a failed source", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a]);
    p.update({ error: "Source failure", playing: false });
    await p.toggle();
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledTimes(2);
    expect(mocks.Audio.extractAndPlay).toHaveBeenLastCalledWith(expect.objectContaining({ refreshSource: true }));
    expect(mocks.Audio.resume).not.toHaveBeenCalled();
  });
  it("keeps repeated songs distinct while queue entries move", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, a, b]);
    const entries = p.getSnapshot().queue;
    expect(new Set(entries.map((t) => t.queueId)).size).toBe(3);
    await p.next();
    const playing = p.current?.queueId;
    p.reorder([entries[2], entries[1], entries[0]]);
    expect(p.current?.queueId).toBe(playing);
    expect(p.getSnapshot().index).toBe(1);
  });
  it("uses the native queue entry identity instead of jumping to the first duplicate", async () => {
    const p = new AudioOrchestrator();
    await p.init();
    await p.playList([a, a, b]);
    const entry = p.getSnapshot().queue[1];
    const callback = mocks.Audio.addListener.mock.calls.find(
      ([name]) => name === "onNativeTrackChanged",
    )?.[1];
    callback!({
      id: a.id,
      queueId: entry.queueId,
      playing: true,
      transport: "youtube",
    });
    expect(p.getSnapshot().index).toBe(1);
  });
  it("advances immediately through rapid skips without waiting for history writes", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, b, a]);
    let release!: () => void;
    mocks.record.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = p.next();
    await p.next();
    expect(p.getSnapshot().index).toBe(2);
    release();
    await first;
    expect(p.getSnapshot().index).toBe(2);
  });
  it("reshuffles only upcoming entries, guarantees a new order, and preserves duplicates", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, b, a, b]);
    const current = p.current?.queueId;
    const before = p
      .getSnapshot()
      .queue.slice(1)
      .map((t) => t.queueId);
    p.reshuffle(() => 0.999);
    const first = p
      .getSnapshot()
      .queue.slice(1)
      .map((t) => t.queueId);
    expect(first).not.toEqual(before);
    expect(first.slice().sort()).toEqual(before.slice().sort());
    expect(p.current?.queueId).toBe(current);
    expect(p.getSnapshot().mode).toBe("smooth");
    p.reshuffle(() => 0.999);
    expect(
      p
        .getSnapshot()
        .queue.slice(1)
        .map((t) => t.queueId),
    ).not.toEqual(first);
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledTimes(1);
  });
  it("rejects stale drag orders when the native current entry has moved", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, b, a]);
    const ids = p
      .getSnapshot()
      .queue.slice(1)
      .map((t) => t.queueId!);
    await p.next();
    const before = p.getSnapshot().queue;
    p.reorderUpcoming(ids.reverse());
    expect(p.getSnapshot().queue).toBe(before);
  });
  it("commits the final queue once after a burst of reorder commands", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, b, a]);
    mocks.Audio.setQueue.mockClear();
    const entries = p.getSnapshot().queue;
    p.reorder([entries[0], entries[2], entries[1]]);
    p.reorder(entries);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.Audio.setQueue).toHaveBeenCalledTimes(1);
    expect(mocks.Audio.setQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQueueId: entries[0].queueId,
        tracks: entries.slice(1),
      }),
    );
  });
  it("cancels buffering from the play control and ignores late state events", async () => {
    const p = new AudioOrchestrator();
    await p.init();
    mocks.Audio.extractAndPlay.mockResolvedValueOnce({
      duration: 200,
      description: "",
      playing: false,
      loading: true,
    } as any);
    await p.playList([a]);
    await p.toggle();
    const event = mocks.Audio.addListener.mock.calls.find(
      ([name]) => name === "onPlaybackStateChanged",
    )?.[1];
    event!({ playing: true, loading: true, queueId: p.current?.queueId });
    expect(p.getSnapshot().loading).toBe(false);
    expect(p.getSnapshot().playing).toBe(false);
    await p.toggle();
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledTimes(2);
  });
  it("expires an unresponsive load and permits a fresh retry", async () => {
    const p = new AudioOrchestrator();
    let finish!: (value: any) => void;
    mocks.Audio.extractAndPlay.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = p.playList([a]);
    await vi.advanceTimersByTimeAsync(30001);
    expect(p.getSnapshot().loading).toBe(false);
    expect(p.getSnapshot().errorCode).toBe("PLAYBACK_TIMEOUT");
    finish({ duration: 200, description: "", playing: true, loading: false });
    await pending;
    expect(p.getSnapshot().playing).toBe(false);
    await p.toggle();
    expect(p.getSnapshot().playing).toBe(true);
  });
  it("keeps a terminal source error when an earlier buffering request returns", async () => {
    const p = new AudioOrchestrator();
    await p.init();
    let finish!: (value: any) => void;
    mocks.Audio.extractAndPlay.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = p.playList([a]);
    const send = (name: string, event: object) =>
      mocks.Audio.addListener.mock.calls.find(([id]) => id === name)?.[1](event);
    send("onTrackError", { queueId: p.current?.queueId, code: "AUDIO_NETWORK", message: "Sin conexión" });
    send("onPlaybackStateChanged", { queueId: p.current?.queueId, playing: false, loading: true });
    finish({ duration: 200, description: "", playing: false, loading: true });
    await pending;
    expect(p.getSnapshot()).toMatchObject({ loading: false, playing: false, errorCode: "AUDIO_NETWORK" });
  });

  it("does not apply a late pause failure to the next selected track", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, b]);
    let rejectPause!: (error: Error) => void;
    mocks.Audio.pause.mockImplementationOnce(() => new Promise((_, reject) => { rejectPause = reject; }));
    const pause = p.pause();
    await p.next();
    rejectPause(new Error("Old request"));
    await pause;
    expect(p.current?.id).toBe(b.id);
    expect(p.getSnapshot()).toMatchObject({ playing: true, error: "" });
  });

  it("ignores stale ready and progress events with a different queue identity", async () => {
    const p = new AudioOrchestrator();
    await p.init();
    await p.playList([a, b]);
    const old = p.current?.queueId;
    await p.next();
    const state = mocks.Audio.addListener.mock.calls.find(
      ([name]) => name === "onPlaybackStateChanged",
    )?.[1];
    const progress = mocks.Audio.addListener.mock.calls.find(
      ([name]) => name === "onPlaybackProgress",
    )?.[1];
    state!({ playing: false, loading: true, queueId: old });
    progress!({ positionMs: 170000, queueId: old });
    expect(p.getSnapshot().loading).toBe(false);
    expect(p.getSnapshot().position).toBe(0);
  });
  it("coalesces seek drags while showing the last position immediately", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a]);
    const one = p.seek(20);
    const two = p.seek(60);
    const three = p.seek(90);
    expect(p.getSnapshot().position).toBe(90);
    expect(mocks.Audio.seekTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(80);
    await Promise.all([one, two, three]);
    expect(mocks.Audio.seekTo).toHaveBeenCalledTimes(1);
    expect(mocks.Audio.seekTo).toHaveBeenCalledWith({ positionMs: 90000 });
  });
  it("keeps a manual selection when the initial native snapshot returns late", async () => {
    const p = new AudioOrchestrator();
    let restore!: (snapshot: any) => void;
    mocks.Audio.getState.mockImplementationOnce(() => new Promise(resolve => { restore = resolve; }));
    const start = p.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.Audio.getState).toHaveBeenCalledOnce();
    await p.playList([b]);
    const selected = p.current?.queueId;
    restore({ playing: true, positionMs: 42000, track: a, queue: [a] });
    await start;
    expect(p.current?.queueId).toBe(selected);
    expect(p.getSnapshot().position).toBe(0);
  });

  it("keeps a new selection while resuming with the outgoing native track still playing", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, b]);
    const outgoing = p.current;
    let ready!: (value: any) => void;
    mocks.Audio.extractAndPlay.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
    const next = p.next();
    const selected = p.current?.queueId;
    mocks.Audio.getState.mockResolvedValueOnce({ playing: true, positionMs: 42000, track: outgoing } as any);
    await p.refreshNativeState();
    expect(p.current?.queueId).toBe(selected);
    expect(p.getSnapshot()).toMatchObject({ position: 0, loading: true });
    ready({ duration: 200, description: "", playing: true, loading: false });
    await next;
    expect(p.current?.id).toBe(b.id);
    expect(p.getSnapshot().playing).toBe(true);
  });

  it("reconciles a notification skip on foreground without restarting its audio", async () => {
    const p = new AudioOrchestrator();
    await p.playList([a, b]);
    await p.pause();
    const entry = p.getSnapshot().queue[1];
    mocks.Audio.getState.mockResolvedValueOnce({
      playing: true,
      positionMs: 42000,
      track: entry,
      loading: false,
    } as any);
    await p.refreshNativeState();
    expect(p.current?.queueId).toBe(entry.queueId);
    expect(p.getSnapshot().position).toBe(42);
    expect(p.getSnapshot().playing).toBe(true);
    expect(mocks.Audio.extractAndPlay).toHaveBeenCalledTimes(1);
  });
  it("bounds buffering after a native automatic advance as well as direct playback", async () => {
    const p = new AudioOrchestrator();
    await p.init();
    await p.playList([a, b]);
    const changed = mocks.Audio.addListener.mock.calls.find(
      ([name]) => name === "onNativeTrackChanged",
    )?.[1];
    changed!({
      id: b.id,
      queueId: p.getSnapshot().queue[1].queueId,
      playing: false,
      loading: true,
    });
    await vi.advanceTimersByTimeAsync(30001);
    expect(p.getSnapshot().loading).toBe(false);
    expect(p.getSnapshot().errorCode).toBe("PLAYBACK_TIMEOUT");
  });
 it("plays a selected queue instance and discards everything before it", async () => {
   const p=new AudioOrchestrator();await p.playList([a,b,a,b]);
   const entries=p.getSnapshot().queue;await p.playQueueEntry(entries[2].queueId!);
   expect(p.getSnapshot().queue.map(t=>t.queueId)).toEqual(entries.slice(2).map(t=>t.queueId));
   expect(p.getSnapshot().index).toBe(0);expect(p.current?.id).toBe(a.id);
 });

});
