import { describe, expect, it } from "vitest";
import { pickTwin, twinScore } from "./spotifyBridge";

const spotify = { title: "Jet Pilot", artist: "System Of A Down", duration: 126 };

describe("Spotify → YouTube Music twin", () => {
  it("picks the same recording and rejects live cuts and other artists", () => {
    const songs = [
      { videoId: "aaaaaaaaaaa", title: "Jet Pilot (Live)", artist: "System Of A Down", duration: 140 },
      { videoId: "bbbbbbbbbbb", title: "Jet Pilot", artist: "Tribute Band", duration: 126 },
      { videoId: "ccccccccccc", title: "Jet Pilot", artist: "System Of A Down", duration: 127 },
    ];
    expect(pickTwin(spotify, songs)?.videoId).toBe("ccccccccccc");
  });

  it("ignores remaster suffixes and features on the Spotify side", () => {
    expect(twinScore({ title: "Bullet - 2011 Remaster", artist: "Misfits", duration: 101 },
      { videoId: "x", title: "Bullet", artist: "Misfits", duration: 100 })).toBeGreaterThan(0.9);
  });

  it("returns nothing when no candidate is safe", () => {
    expect(pickTwin(spotify, [{ videoId: "d", title: "Toxicity", artist: "System Of A Down", duration: 219 }])).toBeUndefined();
  });
});
