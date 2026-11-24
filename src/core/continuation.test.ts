import { describe, expect, it, vi } from "vitest";
vi.mock("./magicShuffle", () => ({
  magicPicks: async () => [
    { id: "yt:1", source: "youtube", title: "Bailarina (Live)", artist: "Miranda!", duration: 200, tags: [] },
    { id: "yt:2", source: "youtube", title: "Perfecta", artist: "Miranda!", duration: 200, tags: [] },
  ],
}));
import { continuationPicks } from "./continuation";
import { bestSong, oncePerSong } from "./VoiceCommandRouter";
import type { QueueItem } from "./types";

const song = (id: string, title: string, artist = "Miranda!"): QueueItem =>
  ({ id, source: "youtube", videoId: id.padEnd(11, "x"), title, artist, duration: 200, tags: [] });

describe("music never stops", () => {
  it("continues with related and recent songs, never another version of one already queued", async () => {
    const queue = [song("a", "Bailarina")];
    const picks = await continuationPicks(queue, queue[0], 3, async () => [song("r", "Don", "Miranda!"), song("b", "Bailarina")]);
    expect(picks.map((p) => p.title)).toEqual(["Perfecta", "Don"]);
    expect(picks.every((p) => p.smart && p.continuation)).toBe(true);
  });
  it("plays the studio recording a voice request names, not a live cut", () => {
    const list = [song("l", "Bailarina (En Vivo)"), song("s", "Bailarina"), song("o", "Otra")];
    expect(bestSong(list, "bailarina", "miranda")?.id).toBe("s");
    expect(bestSong(list, "cancion inexistente")).toBeUndefined();
  });
  it("keeps one entry per song in a voice mix", () =>
    expect(oncePerSong([song("a", "Don"), song("b", "Don (Official Video)"), song("c", "Perfecta")]).map((t) => t.id)).toEqual(["a", "c"]));
});
