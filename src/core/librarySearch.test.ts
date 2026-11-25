import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALBUM_SORTS,
  ARTIST_SORTS,
  PLAYLIST_SORTS,
  SONG_SORTS,
  addedRanks,
  albumIndexer,
  artistIndexer,
  collectAlbums,
  collectArtists,
  compareText,
  createIndexer,
  editDistance,
  filterItems,
  fold,
  groupStat,
  likedPositions,
  loadSort,
  playStats,
  playlistIndexer,
  rememberOpened,
  saveSort,
  searchItems,
  searchLibrary,
  songIndexer,
  sortAlbums,
  sortArtists,
  sortPlaylists,
  sortSongs,
  tokenize,
} from "./librarySearch";
import type { HistoryEntry, Playlist, QueueItem } from "./types";

const song = (id: string, title: string, artist: string, extra: Partial<QueueItem> = {}): QueueItem => ({
  id,
  title,
  artist,
  source: "spotify",
  duration: 200,
  tags: [],
  ...extra,
});
const heard = (trackId: string, at: number, seconds = 200): HistoryEntry => ({ trackId, at, seconds, skipped: false });
const ids = (items: { id: string }[]) => items.map((item) => item.id);
const index = (tracks: QueueItem[]) => songIndexer()(tracks);

const library = [
  song("s1", "Bohemian Rhapsody", "Queen", { album: "A Night at the Opera" }),
  song("s2", "Killer Queen", "Queen", { album: "Sheer Heart Attack" }),
  song("s3", "Afuera", "Caifanes", { album: "El Nervio del Volcán" }),
  song("s4", "La Célula Que Explota", "Caifanes", { album: "El Diablito" }),
  song("s5", "Enter Sandman", "Metallica", { album: "Metallica" }),
  song("s6", "Highway to Hell", "AC/DC", { album: "Highway to Hell" }),
  song("s7", "Don't Stop Me Now", "Queen", { album: "Jazz" }),
  song("s8", "Mañana", "Bomba Estéreo, Li Saumet"),
];

describe("fold y tokenize", () => {
  it("ignores accents, case and punctuation", () => {
    expect(fold("La Célula Que Explota")).toBe("la celula que explota");
    expect(fold("MAÑANA")).toBe("manana");
    expect(fold("AC/DC")).toBe("ac dc");
    expect(fold("Don't Stop")).toBe("dont stop");
  });
  it("keeps letters of other scripts", () => {
    // Marks fold away in every script (й → и), the same way for the query and the library.
    expect(fold("Мумий Тролль")).toBe("мумии тролль");
    expect(fold("宇多田ヒカル")).toBe("宇多田ヒカル");
  });
  it("splits into distinct words and handles empty input", () => {
    expect(tokenize("  Queen   queen QUEEN live ")).toEqual(["queen", "live"]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ¡¿!?  ")).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });
});

describe("editDistance", () => {
  it("counts edits and swaps of neighbours", () => {
    expect(editDistance("queen", "queen", 2)).toBe(0);
    expect(editDistance("quen", "queen", 2)).toBe(1);
    expect(editDistance("metalica", "metallica", 2)).toBe(1);
    expect(editDistance("caifnaes", "caifanes", 2)).toBe(1);
  });
  it("stops past the budget", () => {
    expect(editDistance("abc", "xyzuvw", 1)).toBe(2);
    expect(editDistance("sandman", "zzzzzzz", 2)).toBe(3);
  });
});

describe("búsqueda", () => {
  it("returns nothing for an empty query", () => {
    expect(searchItems(index(library), "").items).toEqual([]);
    expect(searchItems(index(library), "   ").items).toEqual([]);
  });
  it("matches without accents or case", () => {
    expect(ids(searchItems(index(library), "celula").items)).toEqual(["s4"]);
    expect(ids(searchItems(index(library), "MANANA").items)).toEqual(["s8"]);
    expect(ids(searchItems(index(library), "volcán").items)).toEqual(["s3"]);
  });
  it("needs every word, in any order and across title, artist and album", () => {
    expect(ids(searchItems(index(library), "queen killer").items)).toEqual(["s2"]);
    expect(ids(searchItems(index(library), "explota caifanes").items)).toEqual(["s4"]);
    expect(ids(searchItems(index(library), "jazz queen").items)).toEqual(["s7"]);
    expect(searchItems(index(library), "queen sandman").items).toEqual([]);
  });
  it("finds word starts while typing and joined names", () => {
    expect(ids(searchItems(index(library), "bohem").items)).toEqual(["s1"]);
    expect(ids(searchItems(index(library), "acdc").items)).toEqual(["s6"]);
    expect(ids(searchItems(index(library), "dont stop").items)).toEqual(["s7"]);
  });
  it("ranks title matches above artist matches", () => {
    const result = ids(searchItems(index(library), "queen").items);
    expect(result[0]).toBe("s2");
    expect(new Set(result)).toEqual(new Set(["s1", "s2", "s7"]));
  });
  it("tolerates small typos only when nothing matches exactly", () => {
    const typo = searchItems(index(library), "metalica");
    expect(typo.fuzzy).toBe(true);
    expect(ids(typo.items)).toEqual(["s5"]);
    expect(ids(searchItems(index(library), "caifnaes afuera").items)).toEqual(["s3"]);
    expect(ids(searchItems(index(library), "bohemain rapsody").items)).toEqual(["s1"]);
    // "rock" never matches "Rick" when an exact match exists.
    const exact = searchItems(index([song("a", "Rock", "X"), song("b", "Rick", "Y")]), "rock");
    expect(exact.fuzzy).toBe(false);
    expect(ids(exact.items)).toEqual(["a"]);
  });
  it("does not forgive typos in very short words", () => {
    expect(searchItems(index(library), "jzz").items).toEqual([]);
    expect(ids(searchItems(index(library), "jaz").items)).toEqual(["s7"]);
    expect(searchItems(index(library), "xyz").items).toEqual([]);
  });
  it("keeps the input order (or the tie break) for equal scores", () => {
    const same = [song("a", "Intro", "Uno"), song("b", "Intro", "Dos"), song("c", "Intro", "Tres")];
    expect(ids(searchItems(index(same), "intro").items)).toEqual(["a", "b", "c"]);
    const plays: Record<string, number> = { a: 1, b: 5, c: 3 };
    expect(ids(searchItems(index(same), "intro", (x, y) => plays[y.id] - plays[x.id]).items)).toEqual(["b", "c", "a"]);
  });
  it("filters a list keeping its order", () => {
    const ordered = [library[6], library[0], library[2], library[1]];
    expect(ids(filterItems(index(ordered), "queen").items)).toEqual(["s7", "s1", "s2"]);
    expect(ids(filterItems(index(ordered), "").items)).toEqual(["s7", "s1", "s3", "s2"]);
    expect(filterItems(index(ordered), "nada parecido").items).toEqual([]);
    expect(filterItems(index(ordered), "kiler").fuzzy).toBe(true);
  });
  it("reuses prepared items between rebuilds", () => {
    const fields = vi.fn((track: QueueItem) => [{ text: track.title, weight: 1 }]);
    const build = createIndexer(fields);
    build(library);
    build(library);
    expect(fields).toHaveBeenCalledTimes(library.length);
  });
});

describe("búsqueda en toda la biblioteca", () => {
  const playlists: Playlist[] = [
    { id: "p1", title: "Rock en español", source: "hybrid", trackIds: ["s3", "s4"] },
    { id: "al", title: "Jazz", kind: "album", source: "spotify", trackIds: ["s7"], artist: "Queen" },
  ];
  const build = (query: string) =>
    searchLibrary(
      {
        songs: songIndexer()(library),
        albums: albumIndexer()(collectAlbums(library, playlists)),
        artists: artistIndexer()(collectArtists(library)),
        playlists: playlistIndexer()(playlists.filter((p) => p.kind !== "album")),
      },
      query,
    );
  it("groups songs, albums, artists and playlists with a total", () => {
    const result = build("caifanes");
    expect(ids(result.songs)).toEqual(["s3", "s4"]);
    expect(result.artists.map((a) => a.name)).toEqual(["Caifanes"]);
    expect(result.albums.map((a) => a.title).sort()).toEqual(["El Diablito", "El Nervio del Volcán"]);
    expect(result.playlists).toEqual([]);
    expect(result.total).toBe(5);
  });
  it("finds playlists and saved albums", () => {
    expect(build("espanol").playlists.map((p) => p.id)).toEqual(["p1"]);
    expect(build("jazz").albums.map((a) => a.key)).toEqual(["al"]);
  });
  it("is empty for an empty query or no match", () => {
    expect(build("").total).toBe(0);
    expect(build("zzzz qqqq").total).toBe(0);
  });
});

describe("historial", () => {
  it("counts plays from 30 s, recent listens from 10 s", () => {
    const stats = playStats([
      heard("a", 100, 200),
      heard("a", 300, 40),
      heard("a", 500, 12),
      heard("a", 900, 3),
      heard("b", 50, 25),
      heard("c", 70, Number.NaN),
      heard("d", 80, 0),
    ]);
    expect(stats.get("a")).toEqual({ plays: 2, seconds: 255, lastAt: 500, firstAt: 100 });
    expect(stats.get("b")).toEqual({ plays: 0, seconds: 25, lastAt: 50, firstAt: 50 });
    expect(stats.has("c")).toBe(false);
    expect(stats.has("d")).toBe(false);
  });
  it("adds up a group", () => {
    const stats = playStats([heard("a", 100), heard("b", 300), heard("b", 200)]);
    expect(groupStat(["a", "b", "b", "zz"], stats)).toEqual({ plays: 3, seconds: 600, lastAt: 300, firstAt: 100 });
    expect(groupStat(["a"], undefined).plays).toBe(0);
  });
});

describe("ordenar canciones", () => {
  const tracks = [
    song("a", "Zeta", "Banda B", { album: "Uno", duration: 300 }),
    song("b", "árbol", "Artista A", { album: "Dos", duration: 120 }),
    song("c", "Beta 10", "Artista A", { duration: 0 }),
    song("d", "Beta 2", "Cantante C", { album: "Alfa", duration: 180, addedAt: 5_000 }),
    song("e", "Eco", "Banda B", { album: "Uno", duration: 240, addedAt: 9_000 }),
  ];
  const stats = playStats([
    heard("a", 1_000),
    heard("a", 2_000),
    heard("c", 3_000),
    heard("b", 7_000, 15),
  ]);
  it("sorts by title with Spanish rules, accents ignored and numbers in order", () => {
    expect(ids(sortSongs(tracks, "title"))).toEqual(["b", "d", "c", "e", "a"]);
  });
  it("sorts by artist, then album, then title", () => {
    expect(ids(sortSongs(tracks, "artist"))).toEqual(["b", "c", "e", "a", "d"]);
  });
  it("sorts by album with songs without album last", () => {
    expect(ids(sortSongs(tracks, "album"))).toEqual(["d", "b", "e", "a", "c"]);
  });
  it("sorts by duration, shortest first, unknown last", () => {
    expect(ids(sortSongs(tracks, "duration"))).toEqual(["b", "d", "e", "a", "c"]);
  });
  it("sorts by plays, then by title for songs never played", () => {
    expect(ids(sortSongs(tracks, "most-played", { stats }))).toEqual(["a", "c", "b", "d", "e"]);
  });
  it("sorts by last listen", () => {
    expect(ids(sortSongs(tracks, "last-played", { stats }))).toEqual(["b", "c", "a", "d", "e"]);
  });
  it("sorts by added date, then liked position, then first listen, then input order", () => {
    const liked = likedPositions([{ id: "sp:liked", trackIds: ["b", "a"] }, { id: "other", trackIds: ["c"] }]);
    expect(ids(sortSongs(tracks, "recent", { liked, stats }))).toEqual(["e", "d", "b", "a", "c"]);
    expect(ids(sortSongs(tracks, "recent"))).toEqual(["e", "d", "a", "b", "c"]);
    expect(addedRanks(tracks, { liked }).get("b")).toBe(2);
  });
  it("is stable and does not change the input", () => {
    const twins = [song("x", "Igual", "Mismo"), song("y", "Igual", "Mismo"), song("z", "Igual", "Mismo")];
    expect(ids(sortSongs(twins, "title"))).toEqual(["x", "y", "z"]);
    expect(ids(sortSongs(twins, "most-played", { stats }))).toEqual(["x", "y", "z"]);
    const copy = [...tracks];
    sortSongs(tracks, "duration");
    expect(tracks).toEqual(copy);
    expect(sortSongs([], "recent")).toEqual([]);
  });
  it("compares text with empty values last", () => {
    expect(compareText("", "a")).toBe(1);
    expect(compareText("a", undefined)).toBe(-1);
    expect(compareText("Ánimo", "animo")).toBe(0);
  });
});

describe("artistas y álbumes", () => {
  const tracks = [
    song("a", "Uno", "Caifanes", { album: "El Diablito", albumId: "d1" }),
    song("b", "Dos", "Caifanes, Saúl Hernández", { album: "El Diablito", albumId: "d1", artworkUrl: "https://i/a.jpg" }),
    song("c", "Tres", "caifanes"),
    song("d", "Cuatro", "Artista por identificar", { album: "Suelto" }),
    song("e", "Cinco", "Jaguares", { album: "Bajo el azul" }),
  ];
  it("collects artists once, case-insensitively, without placeholders", () => {
    const artists = collectArtists(tracks);
    expect(artists.map((a) => [a.name, a.count])).toEqual([
      ["Caifanes", 3],
      ["Saúl Hernández", 1],
      ["Jaguares", 1],
    ]);
    expect(artists[0].cover?.id).toBe("b");
  });
  it("sorts artists by plays, name, songs and last listen", () => {
    const artists = collectArtists(tracks);
    const stats = playStats([heard("e", 10), heard("e", 20), heard("a", 900)]);
    expect(sortArtists(artists, "most-played", stats).map((a) => a.name)).toEqual(["Jaguares", "Caifanes", "Saúl Hernández"]);
    expect(sortArtists(artists, "az").map((a) => a.name)).toEqual(["Caifanes", "Jaguares", "Saúl Hernández"]);
    expect(sortArtists(artists, "count").map((a) => a.name)).toEqual(["Caifanes", "Jaguares", "Saúl Hernández"]);
    expect(sortArtists(artists, "last-played", stats).map((a) => a.name)).toEqual(["Caifanes", "Jaguares", "Saúl Hernández"]);
  });
  it("collects saved albums and albums known from songs, without repeating", () => {
    const saved: Playlist = { id: "sp:album", title: "Bajo el azul", kind: "album", source: "spotify", trackIds: ["e"] };
    const albums = collectAlbums(tracks, [saved, { id: "pl", title: "Mix", source: "hybrid", trackIds: ["a"] }]);
    expect(albums.map((a) => [a.key, a.title, a.artist, a.count])).toEqual([
      ["sp:album", "Bajo el azul", "Jaguares", 1],
      ["local:album:d1", "El Diablito", "Caifanes", 2],
      ["local:album:Artista%20por%20identificar%2FSuelto", "Suelto", "", 1],
    ]);
    expect(albums[1].cover).toMatchObject({ id: "b" });
  });
  it("sorts albums by added, plays, title, artist and songs", () => {
    const albums = collectAlbums(tracks, []);
    const ranks = addedRanks([...tracks].reverse());
    expect(sortAlbums(albums, "recent", { ranks }).map((a) => a.title)).toEqual(["Bajo el azul", "Suelto", "El Diablito"]);
    const stats = playStats([heard("a", 1), heard("b", 2), heard("e", 3)]);
    expect(sortAlbums(albums, "most-played", { stats }).map((a) => a.title)).toEqual(["El Diablito", "Bajo el azul", "Suelto"]);
    expect(sortAlbums(albums, "title").map((a) => a.title)).toEqual(["Bajo el azul", "El Diablito", "Suelto"]);
    expect(sortAlbums(albums, "artist").map((a) => a.title)).toEqual(["El Diablito", "Bajo el azul", "Suelto"]);
    expect(sortAlbums(albums, "count").map((a) => a.title)).toEqual(["El Diablito", "Bajo el azul", "Suelto"]);
  });
});

describe("playlists", () => {
  const playlists: Playlist[] = [
    { id: "p1", title: "Zona", source: "hybrid", trackIds: ["a"] },
    { id: "p2", title: "alfa", source: "hybrid", trackIds: ["a", "b", "c"] },
    { id: "p3", title: "Medio", source: "spotify", trackIds: ["b", "c"] },
    { id: "p4", title: "Nunca", source: "spotify", trackIds: [] },
  ];
  it("sorts by recent use: opened or heard", () => {
    const stats = playStats([heard("c", 400)]);
    expect(ids(sortPlaylists(playlists, "recent", { stats, opened: { p1: 500 } }))).toEqual(["p1", "p2", "p3", "p4"]);
    expect(ids(sortPlaylists(playlists, "recent", { opened: { p3: 10 } }))).toEqual(["p3", "p1", "p2", "p4"]);
    expect(ids(sortPlaylists(playlists, "recent"))).toEqual(["p1", "p2", "p3", "p4"]);
  });
  it("sorts A–Z and by number of songs", () => {
    expect(ids(sortPlaylists(playlists, "az"))).toEqual(["p2", "p3", "p4", "p1"]);
    expect(ids(sortPlaylists(playlists, "count"))).toEqual(["p2", "p3", "p1", "p4"]);
  });
  it("remembers opened playlists, newest kept", () => {
    let opened: Record<string, number> = {};
    for (let i = 0; i < 5; i++) opened = rememberOpened(opened, "p" + i, i, 3);
    expect(opened).toEqual({ p4: 4, p3: 3, p2: 2 });
    expect(rememberOpened(opened, "p2", 9, 3)).toEqual({ p2: 9, p4: 4, p3: 3 });
  });
});

describe("orden guardado", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("falls back without storage or with an unknown value", () => {
    expect(loadSort("songs", SONG_SORTS, "recent")).toBe("recent");
    const store = new Map<string, string>([["murmur.sort.artists", "nope"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    expect(loadSort("artists", ARTIST_SORTS, "most-played")).toBe("most-played");
    saveSort("albums", "count");
    expect(store.get("murmur.sort.albums")).toBe("count");
    expect(loadSort("albums", ALBUM_SORTS, "recent")).toBe("count");
    expect(loadSort("playlists", PLAYLIST_SORTS, "recent")).toBe("recent");
  });
  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadSort("songs", SONG_SORTS, "title")).toBe("title");
    expect(() => saveSort("songs", "title")).not.toThrow();
  });
  it("offers the options the owner asked for", () => {
    expect(SONG_SORTS.map((o) => o.label)).toEqual([
      "Agregadas recientemente",
      "Más escuchadas",
      "Escuchadas recientemente",
      "Título A–Z",
      "Artista A–Z",
      "Álbum",
      "Duración",
    ]);
    expect(ALBUM_SORTS.map((o) => o.value)).toEqual(["recent", "most-played", "title", "artist", "count"]);
    expect(ARTIST_SORTS[0].value).toBe("most-played");
    expect(PLAYLIST_SORTS.map((o) => o.value)).toEqual(["recent", "az", "count"]);
  });
});
