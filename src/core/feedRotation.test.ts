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

import { genericPlaylist, withoutGeneric } from "./feedRotation";
describe("Inicio leaves out YouTube Music's generic playlists", () => {
  const item = (id: string, subtitle: string) => ({ id, title: id, subtitle, link: "https://music.youtube.com/playlist?list=" + id });
  it("drops editorial playlists, keeps community playlists and personal mixes", () => {
    expect(genericPlaylist(item("RDCLAK5uy_abc", "Playlist • YouTube Music"))).toBe(true);
    expect(genericPlaylist(item("PLxyz", "Playlist • YouTube Music"))).toBe(true);
    expect(genericPlaylist(item("PLcommunity", "Playlist • Juan Pérez • 2.3 K vistas"))).toBe(false);
    expect(genericPlaylist(item("RDTMAK5uy_mix", "Mi mix • YouTube Music"))).toBe(false);
  });
  it("removes a section that ends up empty and keeps the rest", () => {
    const shelves = [
      { title: "Playlists destacadas", items: [item("RDCLAK5uy_1", "YouTube Music"), item("RDCLAK5uy_2", "YouTube Music")] },
      { title: "De la comunidad", items: [item("PLa", "Playlist • Ana"), item("PLb", "Playlist • Beto"), item("RDCLAK5uy_3", "YouTube Music"), item("PLc", "Playlist • Caro")] },
    ];
    expect(withoutGeneric(shelves).map((s) => [s.title, s.items.length])).toEqual([["De la comunidad", 3]]);
  });
});
