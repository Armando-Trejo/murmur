import { beforeEach, describe, expect, it, vi } from "vitest";

const prefetch = vi.fn(async (_: { videoIds: string[] }) => {});
vi.mock("../native", () => ({ isNative: true, Audio: { prefetchAudio: (o: { videoIds: string[] }) => prefetch(o) } }));

const { prefetchAudio } = await import("./prefetch");
const yt = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id: "yt:" + id, videoId: id, source: "youtube", title: id, artist: "", duration: 1, tags: [], ...extra }) as never;

describe("prefetchAudio", () => {
  beforeEach(() => prefetch.mockClear());

  it("warms only online YouTube tracks, up to the limit", () => {
    prefetchAudio([yt("aaaaaaaaaa1"), yt("aaaaaaaaaa2", { offlinePath: "/x.m4a" }), yt("aaaaaaaaaa3", { source: "spotify" }), yt("aaaaaaaaaa4"), yt("aaaaaaaaaa5")], 2, 1_000_000);
    expect(prefetch).toHaveBeenCalledWith({ videoIds: ["aaaaaaaaaa1", "aaaaaaaaaa4"] });
  });

  it("does not repeat a video inside the cooldown", () => {
    prefetchAudio([yt("bbbbbbbbbb1")], 1, 2_000_000);
    prefetchAudio([yt("bbbbbbbbbb1")], 1, 2_000_000 + 60_000);
    expect(prefetch).toHaveBeenCalledTimes(1);
    prefetchAudio([yt("bbbbbbbbbb1")], 1, 2_000_000 + 121_000);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("respects Data Saver", () => {
    Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
    prefetchAudio([yt("ccccccccccc")], 1, 3_000_000);
    expect(prefetch).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "connection", { value: undefined, configurable: true });
  });
});
