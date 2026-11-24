import { describe, expect, it } from "vitest";
import { artistCircles, blend, keywordFamily, songKey } from "./blendMixes";
import type { QueueItem } from "./types";

const t = (id: string, title: string, artist: string, source: "spotify" | "youtube"): QueueItem =>
  ({ id, title, artist, source, duration: 200, tags: [] });

describe("blend mixes", () => {
  it("places genres in families", () => {
    expect(keywordFamily("horror punk")).toBe("Punk y hardcore");
    expect(keywordFamily("corridos tumbados")).toBe("Regional mexicano");
    expect(keywordFamily("latin trap")).toBe("Hip hop y rap");
    expect(keywordFamily("glitch")).toBeUndefined();
  });

  it("treats the same song on both providers as one", () => {
    expect(songKey(t("a", "Bullet (Remastered)", "Misfits", "spotify"))).toBe(songKey(t("b", "Bullet", "Misfits - Topic", "youtube")));
  });

  it("interleaves providers, drops duplicates and spaces out artists", () => {
    const sp = [t("s1", "Uno", "A", "spotify"), t("s2", "Dos", "A", "spotify"), t("s3", "Tres", "B", "spotify")];
    const yt = [t("y1", "Uno", "A", "youtube"), t("y2", "Cuatro", "C", "youtube")];
    const out = blend([sp, yt], 10);
    expect(out.map((x) => x.id)).toEqual(["s1", "y2", "s2", "s3"]);
    for (let i = 1; i < out.length; i++) expect(out[i].artist).not.toBe(out[i - 1].artist);
    expect(new Set(out.map((x) => songKey(x))).size).toBe(out.length);
  });

  it("groups favourite artists into circles of related artists", () => {
    const related = new Map([
      ["misfits", ["Dead Kennedys", "Bad Religion"]],
      ["dead kennedys", ["Black Flag", "Misfits"]],
      ["enjambre", ["Zoé", "Odisseo"]],
      ["odisseo", ["Enjambre", "Zoé"]],
    ]);
    const circles = artistCircles(["Misfits", "Enjambre", "Dead Kennedys", "Odisseo"], related);
    expect(circles.map((c) => c.members)).toEqual([["Misfits", "Dead Kennedys"], ["Enjambre", "Odisseo"]]);
    expect(circles[0].related).toEqual(["Bad Religion", "Black Flag"]);
  });

  it("excludes songs already known", () => {
    const out = blend([[t("s1", "Uno", "A", "spotify"), t("s2", "Dos", "B", "spotify")]], 10, new Set([songKey(t("x", "Uno", "A", "youtube"))]));
    expect(out.map((x) => x.id)).toEqual(["s2"]);
  });
});
