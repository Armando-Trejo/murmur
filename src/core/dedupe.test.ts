import { describe, expect, it } from "vitest";
import { uniqueSongs, versionKey } from "./dedupe";
import type { QueueItem } from "./types";

const t = (id: string, title: string, artist: string, source: "spotify" | "youtube", duration = 120): QueueItem =>
  ({ id, title, artist, source, duration, tags: [] });

describe("biblioteca sin duplicados", () => {
  it("merges the same recording from both providers", () => {
    const { songs, copies } = uniqueSongs([
      t("sp:1", "Bullet - 2011 Remaster", "Misfits", "spotify", 101),
      t("yt:1", "Bullet", "Misfits - Topic", "youtube", 100),
    ]);
    expect(songs.map((s) => s.id)).toEqual(["yt:1"]);
    expect(copies.get("yt:1")).toBe(2);
  });

  it("keeps live versions, remixes and different lengths apart", () => {
    expect(versionKey(t("a", "Bullet (Live)", "Misfits", "spotify"))).not.toBe(versionKey(t("b", "Bullet", "Misfits", "spotify")));
    const { songs } = uniqueSongs([
      t("sp:1", "Last Caress", "Misfits", "spotify", 118),
      t("yt:2", "Last Caress", "Misfits", "youtube", 200),
    ]);
    expect(songs).toHaveLength(2);
  });

  it("keeps the one you play the most", () => {
    const { songs } = uniqueSongs(
      [t("sp:1", "Hybrid Moments", "Misfits", "spotify", 102), t("yt:1", "Hybrid Moments", "Misfits", "youtube", 103)],
      { "sp:1": { plays: 4, seconds: 400 } },
    );
    expect(songs.map((s) => s.id)).toEqual(["sp:1"]);
  });
});
