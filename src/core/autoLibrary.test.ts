import { describe, expect, it } from "vitest";
import { carTrack } from "./autoLibrary";
import type { QueueItem } from "./types";

const song = (over: Partial<QueueItem>): QueueItem => ({
  id: "x", source: "youtube", title: "Bailarina", artist: "Miranda!", duration: 284, tags: [], ...over,
});

describe("Android Auto library", () => {
  it("keeps YouTube songs the car can start and drops the rest", () => {
    expect(carTrack(song({ videoId: "abc" }), true)?.videoId).toBe("abc");
    expect(carTrack(song({}), true)).toBeUndefined();
    expect(carTrack(song({ videoId: "abc", deleted: true }), true)).toBeUndefined();
  });
  it("plays Spotify songs the way MURMUR plays them", () => {
    const spotify = song({ id: "sp:1", source: "spotify", spotifyUri: "spotify:track:3Q2YTJihx6gPSyEgSzi44U" });
    // Spotify's own player inside MURMUR.
    expect(carTrack(spotify, false)).toMatchObject({ source: "spotify", spotifyUri: spotify.spotifyUri });
    // Through its YouTube Music twin: only when the twin is known.
    expect(carTrack(spotify, true)).toBeUndefined();
    const twin = { videoId: "yt1", title: "Bailarina", artist: "Miranda!", duration: 284 };
    expect(carTrack(spotify, true, twin)).toMatchObject({ id: "sp:1", source: "youtube", videoId: "yt1", bridgedFrom: "spotify" });
  });
  it("uses the names the owner corrected", () => {
    expect(carTrack(song({ videoId: "a", edits: { title: "Mi título", artist: "Yo" } }), true)).toMatchObject({ title: "Mi título", artist: "Yo" });
  });
});
