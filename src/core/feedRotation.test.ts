import { describe, expect, it } from "vitest";
import { feedMoods, moodShelves, pickWindow, rotateShelves } from "./feedRotation";
import type { FeedShelf } from "../native";

const shelf = (title: string, n: number): FeedShelf => ({
  title, items: Array.from({ length: n }, (_, i) => ({ id: `${title}-${i}`, title: `${title} ${i}` })),
});

describe("«Para ti» changes on every reload", () => {
  const feed = [shelf("Vuelve a escucharlo", 16), shelf("Álbumes para ti", 10), shelf("Mixes personalizados", 4), shelf("Últimos lanzamientos", 10)];

  it("keeps the first section and moves the others", () => {
    const a = rotateShelves(feed, 1).map((s) => s.title);
    const b = rotateShelves(feed, 2).map((s) => s.title);
    expect(a[0]).toBe("Vuelve a escucharlo");
    expect(b[0]).toBe("Vuelve a escucharlo");
    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual(feed.map((s) => s.title).sort());
  });

  it("long carousels start on other cards; short ones keep their order", () => {
    const rotated = rotateShelves(feed, 1);
    const albums = rotated.find((s) => s.title === "Álbumes para ti")!;
    expect(albums.items[0].id).not.toBe("Álbumes para ti-0");
    expect(albums.items).toHaveLength(10);
    expect(rotated.find((s) => s.title === "Mixes personalizados")!.items[0].id).toBe("Mixes personalizados-0");
    expect(rotated[0].items[0].id).toBe("Vuelve a escucharlo-0");
  });

  it("adds a mood section without repeating what the feed has", () => {
    const mood = [shelf("Mixes personalizados", 4), shelf("Álbumes para ti", 10), shelf("Rap", 10), shelf("Ritmos de discoteca", 10), shelf("Corto", 2)];
    expect(moodShelves("Energía", mood, feed).map((s) => s.title)).toEqual(["Energía · Rap", "Energía · Ritmos de discoteca"]);
  });

  it("skips podcasts and sleep moods", () => {
    const chips = [{ title: "Pódcasts", params: "a" }, { title: "Fiesta", params: "b" }, { title: "Dormir", params: "c" }, { title: "Relax", params: "d" }];
    expect(feedMoods(chips).map((c) => c.title)).toEqual(["Fiesta", "Relax"]);
  });

  it("takes another slice of the Spotify pool each round", () => {
    const pool = Array.from({ length: 70 }, (_, i) => i);
    const first = pickWindow(pool, 1, 20);
    const second = pickWindow(pool, 2, 20);
    expect(first).toHaveLength(20);
    expect(first.filter((n) => second.includes(n))).toHaveLength(0);
    expect(pickWindow([1, 2], 5, 20)).toEqual([1, 2]);
  });
});
