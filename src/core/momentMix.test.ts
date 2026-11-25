import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry, QueueItem } from "./types";

const mock = vi.hoisted(() => ({
  picks: vi.fn(async (_queue: QueueItem[], _seed: QueueItem | undefined, _count: number, _recent?: () => Promise<QueueItem[]>) => [] as QueueItem[]),
  vibe: vi.fn(async (_query: string) => ({ tracks: [] as QueueItem[] })),
  rank: vi.fn(async (_o: { query: string; tags: string[] }) => ({ ranked: [] as { text: string; score: number }[] })),
}));
vi.mock("../native", () => ({ isNative: true, Voice: { rankTags: mock.rank }, Audio: {}, Auth: {} }));
vi.mock("./continuation", () => ({ continuationPicks: mock.picks }));
vi.mock("./VoiceCommandRouter", () => ({
  vibeFromCatalogue: mock.vibe,
  longForm: (t: QueueItem) => t.duration > 12 * 60,
}));

import { db } from "./db";
import { songKey } from "./blendMixes";
import {
  applyMood, buildMomentMix, clearMomentMixCache, dayClass, focusedQueue, hourDistance, hourWindow, interleave,
  momentFor, momentMixPreview, momentProfile, momentReason, momentSubtitle, peekMomentMix, pickYours, playWeight,
  rankDiscoveries, recentKeys, scoreSongs, spaceArtists, weightedOrder, type ScoredSong,
} from "./momentMix";

// Wednesday 25 November 2026, 20:00 (local time).
const NOW = new Date(2026, 10, 25, 20, 0);
const MIN = 60_000;
const at = (daysAgo: number, hour: number, minute = 0, from = NOW) => {
  const d = new Date(from);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};
/** Deterministic random numbers (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const song = (id: string, title: string, artist: string, extra: Partial<QueueItem> = {}): QueueItem =>
  ({ id, source: "youtube", videoId: id.padEnd(11, "x"), title, artist, duration: 240, tags: [], ...extra });
const play = (trackId: string, when: number, seconds = 240, skipped = false): HistoryEntry => ({ trackId, at: when, seconds, skipped });
const scored = (track: QueueItem, score: number): ScoredSong => ({ track, key: songKey(track), score, plays: 1 });
const maxRun = (tracks: { artist: string }[]) => {
  let best = 0;
  let run = 0;
  tracks.forEach((t, i) => { run = i && tracks[i - 1].artist === t.artist ? run + 1 : 1; best = Math.max(best, run); });
  return best;
};

/**
 * Someone who plays Caifanes and Enjambre on weekday evenings, Bad Bunny in the mornings, Natalia
 * Lafourcade on weekend evenings, and always skips Arjona.
 */
const EVENING: Record<string, number> = { Caifanes: 6, Enjambre: 5, "Zoé": 4, "Café Tacvba": 4, Molotov: 3 };
const ROTATION = ["Caifanes", "Enjambre", "Caifanes", "Zoé", "Enjambre", "Café Tacvba", "Molotov", "Caifanes"];
function listener() {
  const library: QueueItem[] = [];
  const byArtist = new Map<string, QueueItem[]>();
  const add = (artist: string, count: number) => {
    const list = Array.from({ length: count }, (_, i) => song(`${artist}-${i}`.replace(/\W/g, ""), `${artist} canción ${i + 1}`, artist));
    byArtist.set(artist, list);
    library.push(...list);
  };
  Object.entries(EVENING).forEach(([artist, count]) => add(artist, count));
  add("Bad Bunny", 3);
  add("Natalia Lafourcade", 3);
  add("Arjona", 2);
  const history: HistoryEntry[] = [];
  for (let k = 1; k <= 50; k++) {
    const day = new Date(at(k, 12)).getDay();
    const weekend = day === 0 || day === 6;
    if (weekend) {
      for (let j = 0; j < 2; j++) history.push(play(byArtist.get("Natalia Lafourcade")![(k + j) % 3].id, at(k, 20, j * 25)));
      continue;
    }
    ROTATION.forEach((artist, j) => {
      const list = byArtist.get(artist)!;
      history.push(play(list[(k + j) % list.length].id, at(k, 19, j * 20)));
    });
    history.push(play(byArtist.get("Arjona")![k % 2].id, at(k, 20, 5), 5, true));
    history.push(play(byArtist.get("Bad Bunny")![k % 3].id, at(k, 8)));
  }
  // An hour and a half ago: not again so soon.
  const afuera = byArtist.get("Caifanes")![0];
  history.push(play(afuera.id, NOW.getTime() - 90 * MIN));
  return { library, history, byArtist, afuera };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mock.picks.mockResolvedValue([]);
  mock.vibe.mockResolvedValue({ tracks: [] });
  mock.rank.mockResolvedValue({ ranked: [] });
  await clearMomentMixCache();
  await db.transaction("rw", db.tables, async () => { for (const t of db.tables) await t.clear(); });
});
afterEach(() => vi.useRealTimers());

describe("the hour window", () => {
  it("tells weekdays from weekends", () => {
    expect(dayClass(new Date(2026, 10, 28))).toBe("weekend"); // Saturday
    expect(dayClass(new Date(2026, 10, 29))).toBe("weekend"); // Sunday
    expect(dayClass(new Date(2026, 10, 27))).toBe("weekday"); // Friday
    expect(dayClass(NOW)).toBe("weekday");
  });

  it("measures hours across midnight", () => {
    expect(hourDistance(new Date(2026, 0, 1, 23, 30), new Date(2026, 0, 2, 0, 30))).toBe(1);
    expect(hourDistance(new Date(2026, 0, 1, 20), new Date(2026, 0, 5, 8))).toBe(12);
    expect(hourDistance(new Date(2026, 0, 1, 19, 15), new Date(2026, 0, 1, 20))).toBe(0.75);
  });

  it("keeps plays within ±2 h, on the same kind of day, in the last 60 days", () => {
    const entries = [
      play("tue-19", at(1, 19)), // Tuesday, 1 h before
      play("mon-2159", at(2, 21, 59)), // Monday, 1:59 later
      play("wed-22", at(7, 22)), // last Wednesday, exactly 2 h
      play("sat-20", at(4, 20)), // Saturday: weekend
      play("tue-1730", at(1, 17, 30)), // 2:30 before
      play("old", at(70, 20)), // too old
      play("future", NOW.getTime() + 10 * MIN),
    ];
    expect(hourWindow(entries, NOW).map((e) => e.trackId)).toEqual(["tue-19", "mon-2159", "wed-22"]);
    expect(hourWindow(entries, NOW, { sameDayClass: false }).map((e) => e.trackId)).toContain("sat-20");
    expect(hourWindow(entries, NOW, { days: 90 }).map((e) => e.trackId)).toContain("old");
  });

  it("wraps around midnight", () => {
    const late = new Date(2026, 10, 26, 0, 30); // Thursday 00:30
    const entries = [play("wed-23", at(0, 23)), play("thu-0230", at(-1, 2, 30)), play("wed-21", at(0, 21))];
    expect(hourWindow(entries, late).map((e) => e.trackId)).toEqual(["wed-23"]);
  });
});

describe("weighting plays", () => {
  const now = NOW.getTime();
  it("counts finished listens most, quick skips against, and halves after a month", () => {
    const full = playWeight(play("a", now), 240, now);
    const half = playWeight(play("a", now, 120), 240, now);
    expect(full).toBeCloseTo(1);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
    expect(playWeight(play("a", now, 8, true), 240, now)).toBeLessThan(0);
    expect(playWeight(play("a", now, 10), 240, now)).toBe(0);
    expect(playWeight(play("a", now - 30 * 86_400_000), 240, now)).toBeCloseTo(0.5);
    expect(playWeight(play("a", now), 240, now, 0.6)).toBeCloseTo(0.6);
    // Unknown length: three minutes count as a full listen.
    expect(playWeight(play("a", now, 180), 0, now)).toBeCloseTo(1);
  });

  it("joins the versions of one song and keeps the one you play most", () => {
    const studio = song("s", "Afuera", "Caifanes");
    const remaster = song("r", "Afuera (Remasterizado)", "Caifanes");
    const other = song("o", "Viento", "Caifanes");
    const byId = new Map([studio, remaster, other].map((t) => [t.id, t]));
    const songs = scoreSongs([play("s", at(1, 20)), play("r", at(2, 20)), play("r", at(3, 20)), play("o", at(1, 20), 5, true)], byId, NOW);
    const afuera = songs.find((s) => s.key === songKey(studio))!;
    expect(songs).toHaveLength(2);
    expect(afuera.plays).toBe(3);
    expect(afuera.track.id).toBe("r");
    expect(songs.find((s) => s.track.id === "o")!.score).toBeLessThan(0);
  });

  it("knows what started in the last 3 hours", () => {
    const a = song("a", "Uno", "X");
    const b = song("b", "Dos", "X");
    const keys = recentKeys([play("a", NOW.getTime() - 170 * MIN, 3, true), play("b", NOW.getTime() - 200 * MIN)], new Map([[a.id, a], [b.id, b]]), NOW);
    expect([...keys]).toEqual([songKey(a)]);
  });
});

describe("choosing and ordering", () => {
  it("puts heavier songs first more often, but not always in the same order", () => {
    const items = [{ item: "fav", weight: 3 }, { item: "b", weight: 1 }, { item: "c", weight: 1 }, { item: "never", weight: 0 }];
    const random = seeded(7);
    let favFirst = 0;
    const orders = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const order = weightedOrder(items, random);
      expect(order).not.toContain("never");
      if (order[0] === "fav") favFirst++;
      orders.add(order.join());
    }
    expect(favFirst / 3000).toBeGreaterThan(0.55); // 3 / 5 expected
    expect(favFirst / 3000).toBeLessThan(0.65);
    expect(orders.size).toBeGreaterThan(3);
  });

  it("keeps the artists of the subtitle, caps each artist and changes from day to day", () => {
    const songs = [
      ...Array.from({ length: 8 }, (_, i) => scored(song(`c${i}`, `C${i}`, "Caifanes"), 5)),
      ...Array.from({ length: 4 }, (_, i) => scored(song(`e${i}`, `E${i}`, "Enjambre"), 2)),
      ...Array.from({ length: 4 }, (_, i) => scored(song(`z${i}`, `Z${i}`, "Zoé"), 1)),
      scored(song("m", "Gimme the power", "Molotov"), 0.05),
    ];
    const first = pickYours(songs, 9, { artists: ["Caifanes", "Molotov"], random: seeded(1) });
    expect(first).toHaveLength(9);
    expect(first.some((t) => t.artist === "Molotov")).toBe(true);
    expect(first.filter((t) => t.artist === "Caifanes")).toHaveLength(3);
    const second = pickYours(songs, 9, { artists: ["Caifanes", "Molotov"], random: seeded(2) });
    expect(second.map((t) => t.id)).not.toEqual(first.map((t) => t.id));
    // Only two artists: more songs each instead of a short mix.
    expect(pickYours(songs.slice(0, 12), 10, { random: seeded(3) })).toHaveLength(10);
  });

  it("spreads discoveries evenly, starting with one of yours", () => {
    const yours = Array.from({ length: 14 }, (_, i) => "y" + i);
    const found = Array.from({ length: 11 }, (_, i) => "d" + i);
    const out = interleave(yours, found);
    expect(out).toHaveLength(25);
    expect(out[0]).toBe("y0");
    expect(out.filter((x) => x.startsWith("y"))).toEqual(yours);
    expect(out.filter((x) => x.startsWith("d"))).toEqual(found);
    const positions = out.flatMap((x, i) => (x.startsWith("d") ? [i] : []));
    for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeLessThanOrEqual(3);
    expect(interleave(["a"], [])).toEqual(["a"]);
    expect(interleave([], ["d"])).toEqual(["d"]);
  });

  it("never plays more than two songs by one artist in a row", () => {
    const random = seeded(11);
    for (let round = 0; round < 200; round++) {
      const artists = ["A", "B", "C"].slice(0, 2 + (round % 2));
      const list = Array.from({ length: 12 }, (_, i) => ({ id: i, artist: random() < 0.7 ? artists[0] : artists[1 + Math.floor(random() * (artists.length - 1))] }));
      const top = Math.max(...artists.map((a) => list.filter((t) => t.artist === a).length));
      const out = spaceArtists(list);
      expect(out).toHaveLength(list.length);
      expect(new Set(out.map((t) => t.id)).size).toBe(list.length);
      // Possible whenever the main artist has at most two songs per other song (plus two at the end).
      if (top <= 2 * (list.length - top + 1)) expect(maxRun(out)).toBeLessThanOrEqual(2);
    }
    const order = [{ artist: "A" }, { artist: "B" }, { artist: "A" }, { artist: "C" }];
    expect(spaceArtists(order)).toEqual(order);
    // Eight by one artist and three by others: only runs of two make it fit.
    const tight = spaceArtists(["A", "A", "A", "A", "A", "A", "A", "A", "B", "C", "D"].map((artist) => ({ artist })));
    expect(tight.map((t) => t.artist).join("")).toBe("AABAACAADAA");
  });

  it("ranks discoveries: closer first, found twice closer still, nothing you play now or dislike", () => {
    const near = song("n", "Cerca", "Nuevo");
    const twice = song("t", "Dos veces", "Otro");
    const mine = song("m", "Afuera", "Caifanes");
    const known = song("k", "Conocida", "Alguien");
    const hated = song("h", "Historia", "Arjona");
    const concert = song("c", "Concierto completo", "Nuevo", { duration: 5400 });
    const ranked = rankDiscoveries([[near, twice, mine, known, hated, concert], [twice]], {
      exclude: new Set([songKey(mine)]), known: new Set([songKey(known)]), disliked: new Set(["arjona"]), random: () => 0,
    });
    const score = (t: QueueItem) => ranked.find((r) => r.track.id === t.id)?.score;
    expect(ranked.map((r) => r.track.id).sort()).toEqual(["k", "n", "t"]);
    expect(score(twice)).toBeGreaterThan(score(near)!);
    expect(score(known)).toBeLessThan(score(near)! - 0.4);
  });

  it("leads the queue for related artists with the artists asked for", () => {
    const songs = ["A", "B", "C", "D", "E"].flatMap((a) => [0, 1, 2].map((i) => song(a + i, a + i, a)));
    const queue = focusedQueue(songs, [songs[0], songs[3]], ["D", "E"]);
    expect(queue).toHaveLength(songs.length);
    expect(queue.slice(-12).map((t) => t.artist).slice(0, 2)).toEqual(["D", "E"]);
  });

  it("uses the mood only to break near ties", () => {
    const a = scored(song("a", "A", "X"), 1);
    const b = scored(song("b", "B", "Y"), 1.05);
    const loved = scored(song("c", "C", "Z"), 3);
    const mood = new Map([["a", 1], ["b", 0], ["c", 0]]);
    expect(applyMood([loved, b, a], (s) => mood.get(s.track.id)).map((s) => s.track.id)).toEqual(["c", "a", "b"]);
  });
});

describe("the words on the card", () => {
  const evening = momentFor(20, 3);
  it("says whose music it is", () => {
    expect(momentSubtitle("hour", ["Caifanes", "Enjambre"], evening)).toBe("Con Caifanes, Enjambre y lo que sueles oír a esta hora");
    expect(momentSubtitle("hour", ["Caifanes", "Enjambre", "Zoé"], evening)).toBe("Con Caifanes, Enjambre, Zoé y lo que sueles oír a esta hora");
    expect(momentSubtitle("hour-any-day", ["Natalia Lafourcade", "Los Bunkers", "Café Tacvba"], evening))
      .toBe("Con Natalia Lafourcade, Los Bunkers y lo que sueles oír a esta hora");
    expect(momentSubtitle("hour", [], evening)).toBe("Lo que sueles oír a esta hora");
    expect(momentSubtitle("taste", ["Caifanes"], evening)).toBe("Con Caifanes y más de lo que te gusta");
    expect(momentSubtitle("catalogue", [], evening)).toBe("Para bajar el ritmo · aún aprendo tus gustos");
  });

  it("explains where the songs come from", () => {
    expect(momentReason("hour", { yours: 14, discoveries: 11 }, NOW))
      .toBe("14 canciones que sueles oír entre semana hacia las 20 h y 11 descubrimientos cercanos.");
    expect(momentReason("hour", { yours: 14, discoveries: 1 }, new Date(2026, 10, 28, 13)))
      .toBe("14 canciones que sueles oír los fines de semana hacia las 13 h y 1 descubrimiento cercano.");
    expect(momentReason("hour-any-day", { yours: 1, discoveries: 0 }, new Date(2026, 10, 25, 0, 20)))
      .toBe("1 canción que sueles oír hacia la medianoche.");
    expect(momentReason("taste", { yours: 6, discoveries: 4, filler: 3 }, NOW))
      .toBe("Aún escuchas poca música a esta hora: 6 de tus favoritas y 4 descubrimientos cercanos, completado con YouTube Music.");
    expect(momentReason("catalogue", { yours: 0, discoveries: 0 }, NOW)).toContain("YouTube Music");
  });
});

describe("the profile of this moment", () => {
  it("is what you play at this hour on weekdays, without what you just heard or skip", () => {
    const { library, history, afuera } = listener();
    const profile = momentProfile(history, library, NOW);
    expect(profile.basis).toBe("hour");
    expect(profile.artists).toEqual(["Caifanes", "Enjambre", "Zoé"]);
    const artists = new Set(profile.songs.map((s) => s.track.artist));
    expect(artists.has("Bad Bunny")).toBe(false); // mornings
    expect(artists.has("Natalia Lafourcade")).toBe(false); // weekends
    expect(artists.has("Arjona")).toBe(false); // always skipped
    expect(profile.songs.some((s) => s.track.id === afuera.id)).toBe(false);
    expect(profile.recent.has(songKey(afuera))).toBe(true);
  });

  it("follows the weekend on a Saturday night", () => {
    const { library, history } = listener();
    const saturday = new Date(2026, 10, 28, 20, 30);
    vi.setSystemTime(saturday);
    const profile = momentProfile(history, library, saturday);
    expect(profile.basis).toBe("hour");
    expect(profile.artists).toEqual(["Natalia Lafourcade"]);
  });

  it("falls back to the same hour on any day, then to your favourites, then to the catalogue", () => {
    const { library, history } = listener();
    // Saturday at 8:00: Bad Bunny is only played on weekday mornings.
    const saturdayMorning = new Date(2026, 10, 28, 8, 30);
    vi.setSystemTime(saturdayMorning);
    const anyDay = momentProfile(history, library, saturdayMorning);
    expect(anyDay.basis).toBe("hour-any-day");
    expect(anyDay.artists[0]).toBe("Bad Bunny");
    // 15:00: nothing at all near this hour.
    const afternoon = new Date(2026, 10, 25, 15);
    expect(momentProfile(history, library, afternoon).basis).toBe("taste");
    expect(momentProfile(history, library, afternoon).artists[0]).toBe("Caifanes");
    expect(momentProfile([], [], NOW).basis).toBe("catalogue");
  });
});

describe("building the mix", () => {
  const discoveries = () => [
    ...Array.from({ length: 14 }, (_, i) => song(`new${i}`, `Nueva ${i}`, `Descubre ${String.fromCharCode(65 + (i % 7))}`, { smart: true, continuation: true })),
    song("hate", "Historia", "Arjona"),
    song("Caifanes1", "Caifanes canción 2", "Caifanes"),
  ];
  async function seed() {
    const data = listener();
    await db.tracks.bulkPut(data.library);
    await db.history.bulkAdd(data.history);
    return data;
  }

  it("mixes 55 % of your music at this hour with 45 % discoveries near it, and keeps it 30 minutes", async () => {
    const { afuera, library } = await seed();
    mock.picks.mockImplementation(async () => discoveries());
    const mix = await buildMomentMix(NOW, { random: seeded(5) });
    const mine = new Set(library.map((t) => t.id));
    expect(mix.title).toBe("Para la noche");
    expect(mix.subtitle).toBe("Con Caifanes, Enjambre, Zoé y lo que sueles oír a esta hora");
    expect(mix.basis).toBe("hour");
    expect(mix.tracks).toHaveLength(25);
    expect(mix.tracks.filter((t) => mine.has(t.id))).toHaveLength(14);
    expect(mix.tracks.filter((t) => t.id.startsWith("new"))).toHaveLength(11);
    expect(mine.has(mix.tracks[0].id)).toBe(true);
    expect(mix.tracks.some((t) => t.id === afuera.id || t.artist === "Arjona")).toBe(false);
    expect(new Set(mix.tracks.map(songKey)).size).toBe(25);
    expect(maxRun(mix.tracks)).toBeLessThanOrEqual(2);
    expect(mix.tracks.every((t) => !t.smart && !t.continuation)).toBe(true);
    for (const artist of mix.artists) expect(mix.tracks.some((t) => t.artist === artist)).toBe(true);
    expect(mix.reason).toBe("14 canciones que sueles oír entre semana hacia las 20 h y 11 descubrimientos cercanos.");
    // Discoveries come from the radio after two of your songs and the related artists of your top ones.
    expect(mock.picks).toHaveBeenCalledTimes(2);
    const [queue, seedSong] = mock.picks.mock.calls[0];
    expect(queue.slice(-12)[0].artist).toBe("Caifanes");
    expect(mine.has(seedSong!.id)).toBe(true);

    // A second tap in the same moment: no network, the same mix.
    const again = await buildMomentMix(new Date(NOW.getTime() + 5 * MIN));
    expect(mock.picks).toHaveBeenCalledTimes(2);
    expect(again.tracks.map((t) => t.id)).toEqual(mix.tracks.map((t) => t.id));
    expect(peekMomentMix(new Date(NOW.getTime() + 5 * MIN))?.subtitle).toBe(mix.subtitle);

    // Songs heard since then are dropped: the next tap goes on with the rest.
    await db.history.add(play(mix.tracks[0].id, NOW.getTime() + 6 * MIN));
    const rest = await buildMomentMix(new Date(NOW.getTime() + 8 * MIN));
    expect(rest.tracks.map((t) => t.id)).toEqual(mix.tracks.slice(1).map((t) => t.id));

    // Half an hour later, or in the next moment, it is built again.
    await buildMomentMix(new Date(NOW.getTime() + 31 * MIN));
    expect(mock.picks).toHaveBeenCalledTimes(4);
    const late = await buildMomentMix(new Date(2026, 10, 25, 23, 5));
    expect(late.title).toBe("Para desvelarte");
  });

  it("shares one build between a prefetch and a tap", async () => {
    await seed();
    mock.picks.mockImplementation(async () => discoveries());
    const [a, b] = await Promise.all([buildMomentMix(NOW), buildMomentMix(NOW)]);
    expect(a).toBe(b);
    expect(mock.picks).toHaveBeenCalledTimes(2);
  });

  it("shows the subtitle from the phone's history alone, before any network", async () => {
    await seed();
    const preview = await momentMixPreview(NOW);
    expect(preview.subtitle).toBe("Con Caifanes, Enjambre, Zoé y lo que sueles oír a esta hora");
    expect(mock.picks).not.toHaveBeenCalled();
    expect(mock.vibe).not.toHaveBeenCalled();
  });

  it("with little history at this hour, uses your favourites ranked by the moment's mood", async () => {
    await seed();
    const afternoon = new Date(2026, 10, 25, 15);
    mock.rank.mockImplementation(async ({ tags }) => ({ ranked: tags.map((text) => ({ text, score: text.startsWith("Molotov") ? 1 : 0.2 })) }));
    mock.picks.mockImplementation(async () => discoveries());
    const mix = await buildMomentMix(afternoon, { random: seeded(9) });
    expect(mix.basis).toBe("taste");
    expect(mix.subtitle).toMatch(/^Con Caifanes, .* y más de lo que te gusta$/);
    expect(mock.rank.mock.calls[0][0].query).toContain("concentrarme");
    expect(mix.tracks).toHaveLength(25);
    expect(mock.vibe).not.toHaveBeenCalled();
  });

  it("only as a last resort plays the catalogue's mix for the mood", async () => {
    mock.vibe.mockResolvedValue({ tracks: Array.from({ length: 12 }, (_, i) => song("cat" + i, "Tranquila " + i, "Artista " + (i % 4))) });
    const mix = await buildMomentMix(NOW);
    expect(mock.vibe).toHaveBeenCalledWith("tranquilo para la noche");
    expect(mix.basis).toBe("catalogue");
    expect(mix.subtitle).toBe("Para bajar el ritmo · aún aprendo tus gustos");
    expect(mix.tracks).toHaveLength(12);
  });

  it("offline with no history: an empty mix, not cached, so the next tap tries again", async () => {
    const mix = await buildMomentMix(NOW);
    expect(mix.tracks).toEqual([]);
    expect(peekMomentMix(NOW)).toBeUndefined();
  });
});
