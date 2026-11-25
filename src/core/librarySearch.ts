import type { HistoryEntry, Playlist, QueueItem } from "./types";

/*
 * «Tu Biblioteca» (2.17): search and ordering for the person's own music, with no network.
 *
 * Search: every word typed must appear in some field (title, artist, album…), in any order,
 * ignoring accents, case and punctuation. Whole words beat word starts, which beat pieces of
 * words. When nothing matches exactly, a second pass tolerates small typos (one letter wrong,
 * missing, extra or two swapped; two for long words).
 *
 * Ordering signals (there is no reliable "date added" in older libraries):
 * - `addedAt` — stamped when a song enters the library from 2.17 on (save, link import, sync).
 * - Position in the liked lists (Spotify «Tus Me Gusta», YouTube «Me gusta»), newest first,
 *   as both services return them.
 * - The first time the song was really heard in MURMUR (history), newest first.
 * - Otherwise the order the library already had.
 * Plays come from `history`: a play counts from 30 s (as everywhere else in MURMUR); a listen of
 * 10 s or more counts as "escuchada recientemente".
 */

/** Lower case, no accents or punctuation; letters of any script and digits survive ("Don't" → "dont"). */
export function fold(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Distinct folded words of a text, in order. */
export function tokenize(value: string | undefined | null): string[] {
  const text = fold(value);
  return text ? [...new Set(text.split(" "))] : [];
}

/**
 * Edit distance counting insertions, deletions, substitutions and swaps of two neighbours.
 * Stops early: any distance above `max` is reported as `max + 1`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let value = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        value = Math.min(value, before[j - 2] + 1);
      row[j] = value;
      if (value < best) best = value;
    }
    if (best > max) return max + 1;
    before = previous;
    previous = row;
  }
  return Math.min(previous[b.length], max + 1);
}

/** Typos forgiven for a word of this length: none under 4 letters, one up to 7, two from 8. */
export const typoBudget = (length: number) => (length >= 8 ? 2 : length >= 4 ? 1 : 0);

export interface SearchField {
  text?: string | null;
  /** How much a match here is worth (title 1, artist ~0.9, album ~0.75). */
  weight: number;
}
export interface PreparedField {
  text: string;
  words: string[];
  /** The text without spaces, so "acdc" finds "AC/DC". */
  compact: string;
  weight: number;
}
export interface Searchable<T> {
  item: T;
  fields: PreparedField[];
}

export function prepareFields(fields: SearchField[]): PreparedField[] {
  return fields.flatMap(({ text, weight }) => {
    const folded = fold(text);
    return folded
      ? [{ text: folded, words: folded.split(" "), compact: folded.replace(/ /g, ""), weight }]
      : [];
  });
}

/**
 * Index builder that remembers each object's prepared fields, so rebuilding after a small change
 * (a new play, one more song) only folds the new objects.
 */
export function createIndexer<T extends object>(fields: (item: T) => SearchField[]) {
  const cache = new WeakMap<T, PreparedField[]>();
  return (items: readonly T[]): Searchable<T>[] =>
    items.map((item) => {
      let prepared = cache.get(item);
      if (!prepared) {
        prepared = prepareFields(fields(item));
        cache.set(item, prepared);
      }
      return { item, fields: prepared };
    });
}

/** How well one typed word matches one field: 0 (not at all) to 1 (a whole word). */
export function wordScore(token: string, field: PreparedField, fuzzy = false): number {
  let best = 0;
  for (const word of field.words) {
    if (word === token) return 1;
    if (word.startsWith(token)) best = Math.max(best, 0.9);
    else if (token.length >= 3 && word.includes(token)) best = Math.max(best, 0.6);
  }
  if (best < 0.62 && token.length >= 3 && field.compact.includes(token)) best = 0.62;
  if (best || !fuzzy) return best;
  const budget = typoBudget(token.length);
  if (!budget) return 0;
  for (const word of field.words) {
    const whole = editDistance(token, word, budget);
    if (whole <= budget) {
      best = Math.max(best, whole === 1 ? 0.72 : 0.6);
      continue;
    }
    // Still typing: the start of a longer word with one letter wrong, missing or extra.
    for (const length of [token.length - 1, token.length, token.length + 1])
      if (length >= 3 && length < word.length && editDistance(token, word.slice(0, length), 1) <= 1) {
        best = Math.max(best, 0.55);
        break;
      }
  }
  return best;
}

/** Score of an item for the typed words; 0 when any word is missing. */
export function scoreFields(fields: PreparedField[], tokens: string[], fuzzy = false): number {
  if (!tokens.length || !fields.length) return 0;
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of fields) {
      const score = wordScore(token, field, fuzzy) * field.weight;
      if (score > best) best = score;
    }
    if (!best) return 0;
    total += best;
  }
  const phrase = tokens.join(" ");
  let bonus = 0;
  for (const field of fields) {
    const value =
      field.text === phrase ? 0.5 : field.text.startsWith(phrase) ? 0.3 : (" " + field.text).includes(" " + phrase) ? 0.15 : 0;
    bonus = Math.max(bonus, value * field.weight);
  }
  return total / tokens.length + bonus;
}

function rank<T>(index: readonly Searchable<T>[], tokens: string[], fuzzy: boolean, tieBreak?: (a: T, b: T) => number) {
  const hits: { item: T; score: number; at: number }[] = [];
  index.forEach((entry, at) => {
    const score = scoreFields(entry.fields, tokens, fuzzy);
    if (score > 0) hits.push({ item: entry.item, score, at });
  });
  hits.sort((a, b) => b.score - a.score || (tieBreak?.(a.item, b.item) ?? 0) || a.at - b.at);
  return hits.map((hit) => hit.item);
}

/** Best matches first; equal scores keep `tieBreak`, then the index order. Strict first, typos only as a fallback. */
export function searchItems<T>(
  index: readonly Searchable<T>[],
  query: string,
  tieBreak?: (a: T, b: T) => number,
): { items: T[]; fuzzy: boolean } {
  const tokens = tokenize(query);
  if (!tokens.length) return { items: [], fuzzy: false };
  const strict = rank(index, tokens, false, tieBreak);
  return strict.length ? { items: strict, fuzzy: false } : { items: rank(index, tokens, true, tieBreak), fuzzy: true };
}

/** Narrows a list that is already in the chosen order, keeping that order. An empty query keeps everything. */
export function filterItems<T>(index: readonly Searchable<T>[], query: string): { items: T[]; fuzzy: boolean } {
  const tokens = tokenize(query);
  if (!tokens.length) return { items: index.map((entry) => entry.item), fuzzy: false };
  const pick = (fuzzy: boolean) =>
    index.filter((entry) => scoreFields(entry.fields, tokens, fuzzy) > 0).map((entry) => entry.item);
  const strict = pick(false);
  return strict.length ? { items: strict, fuzzy: false } : { items: pick(true), fuzzy: true };
}

/* ---------- Listening history ---------- */

export interface PlayStat {
  /** Listens of 30 s or more. */
  plays: number;
  /** Every second heard (each entry capped at 2 h). */
  seconds: number;
  /** Last and first listen of 10 s or more (0 when none). */
  lastAt: number;
  firstAt: number;
}
export type PlayStats = Map<string, PlayStat>;
export const COUNTED_PLAY_SECONDS = 30;
export const BRIEF_LISTEN_SECONDS = 10;

export function playStats(history: readonly HistoryEntry[]): PlayStats {
  const stats: PlayStats = new Map();
  for (const entry of history) {
    if (!entry || !Number.isFinite(entry.seconds) || entry.seconds <= 0 || !Number.isFinite(entry.at)) continue;
    let stat = stats.get(entry.trackId);
    if (!stat) stats.set(entry.trackId, (stat = { plays: 0, seconds: 0, lastAt: 0, firstAt: 0 }));
    stat.seconds += Math.min(entry.seconds, 7200);
    if (entry.seconds >= COUNTED_PLAY_SECONDS) stat.plays++;
    if (entry.seconds >= BRIEF_LISTEN_SECONDS) {
      if (entry.at > stat.lastAt) stat.lastAt = entry.at;
      if (!stat.firstAt || entry.at < stat.firstAt) stat.firstAt = entry.at;
    }
  }
  return stats;
}

/** Plays, seconds and last listen of a group of songs (an album, an artist, a playlist). */
export function groupStat(trackIds: readonly string[], stats: PlayStats | undefined): PlayStat {
  const total: PlayStat = { plays: 0, seconds: 0, lastAt: 0, firstAt: 0 };
  if (!stats?.size) return total;
  for (const id of new Set(trackIds)) {
    const stat = stats.get(id);
    if (!stat) continue;
    total.plays += stat.plays;
    total.seconds += stat.seconds;
    if (stat.lastAt > total.lastAt) total.lastAt = stat.lastAt;
    if (stat.firstAt && (!total.firstAt || stat.firstAt < total.firstAt)) total.firstAt = stat.firstAt;
  }
  return total;
}

/* ---------- Comparators ---------- */

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true, ignorePunctuation: true });
/** Alphabetical (Spanish rules, accents ignored, "2" before "10"); empty text goes last. */
export function compareText(a: string | undefined, b: string | undefined): number {
  const x = a?.trim() ?? "";
  const y = b?.trim() ?? "";
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return collator.compare(x, y);
}
/** Larger first; missing or zero values last. */
function descending(a: number | undefined, b: number | undefined): number {
  const x = a && Number.isFinite(a) ? a : 0;
  const y = b && Number.isFinite(b) ? b : 0;
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return y - x;
}
/** Smaller first; missing values last. */
function ascending(a: number | undefined, b: number | undefined): number {
  const x = a !== undefined && Number.isFinite(a) ? a : undefined;
  const y = b !== undefined && Number.isFinite(b) ? b : undefined;
  if (x === undefined || y === undefined) return x !== undefined ? -1 : y !== undefined ? 1 : 0;
  return x - y;
}
/** Stable sort: equal items keep their input order. */
function stableSort<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, at) => ({ item, at }))
    .sort((a, b) => compare(a.item, b.item) || a.at - b.at)
    .map((entry) => entry.item);
}

/* ---------- Songs ---------- */

/** Liked lists, returned newest first by Spotify and YouTube Music. */
export const LIKED_PLAYLIST_IDS = ["sp:liked", "ytpl:VLLM", "ytpl:LM"];
export function likedPositions(playlists: readonly Pick<Playlist, "id" | "trackIds">[]): Map<string, number> {
  const positions = new Map<string, number>();
  for (const playlist of playlists) {
    if (!LIKED_PLAYLIST_IDS.includes(playlist.id)) continue;
    playlist.trackIds.forEach((id, at) => {
      const known = positions.get(id);
      if (known === undefined || at < known) positions.set(id, at);
    });
  }
  return positions;
}

export interface OrderContext {
  stats?: PlayStats;
  /** Song id → position in a liked list (0 = liked most recently). */
  liked?: Map<string, number>;
}

/** "Agregadas recientemente": added date, then liked position, then first listen, then the input order. */
export function compareAdded(a: QueueItem, b: QueueItem, context: OrderContext = {}): number {
  return (
    descending(a.addedAt, b.addedAt) ||
    ascending(context.liked?.get(a.id), context.liked?.get(b.id)) ||
    descending(context.stats?.get(a.id)?.firstAt, context.stats?.get(b.id)?.firstAt)
  );
}

/** Song id → rank in "Agregadas recientemente" (0 = newest). */
export function addedRanks(tracks: readonly QueueItem[], context: OrderContext = {}): Map<string, number> {
  const ranks = new Map<string, number>();
  stableSort(tracks, (a, b) => compareAdded(a, b, context)).forEach((track, at) => {
    if (!ranks.has(track.id)) ranks.set(track.id, at);
  });
  return ranks;
}

export type SongSort = "recent" | "most-played" | "last-played" | "title" | "artist" | "album" | "duration";

export function sortSongs(tracks: readonly QueueItem[], sort: SongSort, context: OrderContext = {}): QueueItem[] {
  const stat = (track: QueueItem) => context.stats?.get(track.id);
  const byTitle = (a: QueueItem, b: QueueItem) => compareText(a.title, b.title) || compareText(a.artist, b.artist);
  switch (sort) {
    case "recent":
      return stableSort(tracks, (a, b) => compareAdded(a, b, context));
    case "most-played":
      return stableSort(
        tracks,
        (a, b) =>
          descending(stat(a)?.plays, stat(b)?.plays) ||
          descending(stat(a)?.seconds, stat(b)?.seconds) ||
          descending(stat(a)?.lastAt, stat(b)?.lastAt) ||
          byTitle(a, b),
      );
    case "last-played":
      return stableSort(tracks, (a, b) => descending(stat(a)?.lastAt, stat(b)?.lastAt) || byTitle(a, b));
    case "title":
      return stableSort(tracks, byTitle);
    case "artist":
      return stableSort(
        tracks,
        (a, b) => compareText(a.artist, b.artist) || compareText(a.album, b.album) || compareText(a.title, b.title),
      );
    case "album":
      return stableSort(
        tracks,
        (a, b) => compareText(a.album, b.album) || compareText(a.artist, b.artist) || compareText(a.title, b.title),
      );
    case "duration":
      return stableSort(
        tracks,
        (a, b) => ascending(a.duration > 0 ? a.duration : undefined, b.duration > 0 ? b.duration : undefined) || byTitle(a, b),
      );
    default:
      return [...tracks];
  }
}

/* ---------- Artists ---------- */

const unknownArtist = /^artista (?:por identificar|no identificad[oa])$/i;
/** Names credited on a song, as the library lists them ("A, B" → A and B). */
export function artistNames(line: string | undefined): string[] {
  return (line ?? "")
    .split(", ")
    .map((name) => name.trim())
    .filter((name) => name && !unknownArtist.test(name));
}

export interface ArtistEntry {
  key: string;
  name: string;
  count: number;
  trackIds: string[];
  /** A song with artwork to show for the artist. */
  cover?: QueueItem;
}

export function collectArtists(tracks: readonly QueueItem[]): ArtistEntry[] {
  const artists = new Map<string, ArtistEntry>();
  for (const track of tracks) {
    const seen = new Set<string>();
    for (const name of artistNames(track.artist)) {
      const key = fold(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let entry = artists.get(key);
      if (!entry) artists.set(key, (entry = { key, name, count: 0, trackIds: [] }));
      entry.count++;
      entry.trackIds.push(track.id);
      if (!entry.cover || (!entry.cover.artworkUrl && !entry.cover.customArtwork && (track.artworkUrl || track.customArtwork)))
        entry.cover = track;
    }
  }
  return [...artists.values()];
}

export type ArtistSort = "most-played" | "az" | "count" | "last-played";

export function sortArtists(artists: readonly ArtistEntry[], sort: ArtistSort, stats?: PlayStats): ArtistEntry[] {
  const totals = new Map(artists.map((artist) => [artist.key, groupStat(artist.trackIds, stats)]));
  const byName = (a: ArtistEntry, b: ArtistEntry) => compareText(a.name, b.name);
  switch (sort) {
    case "most-played":
      return stableSort(
        artists,
        (a, b) =>
          descending(totals.get(a.key)?.plays, totals.get(b.key)?.plays) ||
          descending(totals.get(a.key)?.seconds, totals.get(b.key)?.seconds) ||
          b.count - a.count ||
          byName(a, b),
      );
    case "count":
      return stableSort(artists, (a, b) => b.count - a.count || byName(a, b));
    case "last-played":
      return stableSort(artists, (a, b) => descending(totals.get(a.key)?.lastAt, totals.get(b.key)?.lastAt) || byName(a, b));
    case "az":
      return stableSort(artists, byName);
    default:
      return [...artists];
  }
}

/* ---------- Albums ---------- */

export interface AlbumEntry {
  key: string;
  title: string;
  artist: string;
  trackIds: string[];
  count: number;
  /** A saved album (imported link or one opened before). */
  playlist?: Playlist;
  /** Songs of an album known only from song data; opening it saves it as an album. */
  items?: QueueItem[];
  cover?: QueueItem | Playlist;
}

/** Most frequent first credited artist of some songs. */
export function mainArtistOf(items: readonly QueueItem[]): string {
  const votes = new Map<string, number>();
  for (const item of items) {
    const name = artistNames(item.artist)[0];
    if (name) votes.set(name, (votes.get(name) ?? 0) + 1);
  }
  let best = "";
  let top = 0;
  for (const [name, count] of votes) if (count > top) [best, top] = [name, count];
  return best;
}

/**
 * Saved albums first, then albums known from the songs' data that are not saved yet
 * (grouped by album id, or artist + album name).
 */
export function collectAlbums(tracks: readonly QueueItem[], playlists: readonly Playlist[]): AlbumEntry[] {
  const lookup = new Map(tracks.map((track) => [track.id, track]));
  const saved = playlists.filter((playlist) => playlist.kind === "album");
  const covered = new Set(saved.flatMap((playlist) => playlist.trackIds));
  const entries: AlbumEntry[] = saved.map((playlist) => {
    const items = playlist.trackIds.flatMap((id) => lookup.get(id) ?? []);
    return {
      key: playlist.id,
      title: playlist.title,
      artist: playlist.artist || mainArtistOf(items),
      trackIds: playlist.trackIds,
      count: playlist.trackIds.length,
      playlist,
      cover: playlist,
    };
  });
  const groups = new Map<string, QueueItem[]>();
  for (const track of tracks) {
    if (!track.album?.trim()) continue;
    const key = track.albumId || track.artist + "/" + track.album;
    const group = groups.get(key);
    if (group) group.push(track);
    else groups.set(key, [track]);
  }
  for (const [key, items] of groups) {
    if (items.some((item) => covered.has(item.id))) continue;
    entries.push({
      key: "local:album:" + encodeURIComponent(key),
      title: items[0].album!,
      artist: mainArtistOf(items),
      trackIds: items.map((item) => item.id),
      count: items.length,
      items,
      cover: items.find((item) => item.artworkUrl || item.customArtwork) ?? items[0],
    });
  }
  return entries;
}

export type AlbumSort = "recent" | "most-played" | "title" | "artist" | "count";

export function sortAlbums(
  albums: readonly AlbumEntry[],
  sort: AlbumSort,
  context: { stats?: PlayStats; ranks?: Map<string, number> } = {},
): AlbumEntry[] {
  const byTitle = (a: AlbumEntry, b: AlbumEntry) => compareText(a.title, b.title) || compareText(a.artist, b.artist);
  switch (sort) {
    case "recent": {
      const newest = new Map(
        albums.map((album) => {
          let best: number | undefined;
          for (const id of album.trackIds) {
            const rank = context.ranks?.get(id);
            if (rank !== undefined && (best === undefined || rank < best)) best = rank;
          }
          return [album.key, best] as const;
        }),
      );
      return stableSort(albums, (a, b) => ascending(newest.get(a.key), newest.get(b.key)));
    }
    case "most-played": {
      const totals = new Map(albums.map((album) => [album.key, groupStat(album.trackIds, context.stats)]));
      return stableSort(
        albums,
        (a, b) =>
          descending(totals.get(a.key)?.plays, totals.get(b.key)?.plays) ||
          descending(totals.get(a.key)?.seconds, totals.get(b.key)?.seconds) ||
          byTitle(a, b),
      );
    }
    case "title":
      return stableSort(albums, byTitle);
    case "artist":
      return stableSort(albums, (a, b) => compareText(a.artist, b.artist) || compareText(a.title, b.title));
    case "count":
      return stableSort(albums, (a, b) => b.count - a.count || byTitle(a, b));
    default:
      return [...albums];
  }
}

/* ---------- Playlists ---------- */

export type PlaylistSort = "recent" | "az" | "count";

/**
 * "Recientes": the later of when it was last opened in MURMUR and when one of its songs was last
 * heard; never-touched playlists keep their order at the end.
 */
export function sortPlaylists(
  playlists: readonly Playlist[],
  sort: PlaylistSort,
  context: { stats?: PlayStats; opened?: Record<string, number> } = {},
): Playlist[] {
  const byTitle = (a: Playlist, b: Playlist) => compareText(a.title, b.title);
  switch (sort) {
    case "recent": {
      const touched = new Map(
        playlists.map((playlist) => [
          playlist.id,
          Math.max(context.opened?.[playlist.id] ?? 0, groupStat(playlist.trackIds, context.stats).lastAt),
        ]),
      );
      return stableSort(playlists, (a, b) => descending(touched.get(a.id), touched.get(b.id)));
    }
    case "az":
      return stableSort(playlists, byTitle);
    case "count":
      return stableSort(playlists, (a, b) => b.trackIds.length - a.trackIds.length || byTitle(a, b));
    default:
      return [...playlists];
  }
}

/** Remembers that a playlist was opened now; keeps the 200 most recent. */
export function rememberOpened(opened: Record<string, number>, id: string, at: number, keep = 200): Record<string, number> {
  const next = Object.entries({ ...opened, [id]: at })
    .filter(([, time]) => Number.isFinite(time))
    .sort((a, b) => b[1] - a[1])
    .slice(0, keep);
  return Object.fromEntries(next);
}

/* ---------- Whole library ---------- */

export interface LibraryIndex {
  songs: Searchable<QueueItem>[];
  albums: Searchable<AlbumEntry>[];
  artists: Searchable<ArtistEntry>[];
  playlists: Searchable<Playlist>[];
}
export interface LibraryResults {
  songs: QueueItem[];
  albums: AlbumEntry[];
  artists: ArtistEntry[];
  playlists: Playlist[];
  total: number;
  /** Only typo-tolerant matches were found. */
  fuzzy: boolean;
}

export const songIndexer = () =>
  createIndexer<QueueItem>((track) => [
    { text: track.title, weight: 1 },
    { text: track.artist, weight: 0.9 },
    { text: track.album, weight: 0.75 },
  ]);
export const albumIndexer = () =>
  createIndexer<AlbumEntry>((album) => [
    { text: album.title, weight: 1 },
    { text: album.artist, weight: 0.85 },
  ]);
export const artistIndexer = () => createIndexer<ArtistEntry>((artist) => [{ text: artist.name, weight: 1 }]);
export const playlistIndexer = () =>
  createIndexer<Playlist>((playlist) => [
    { text: playlist.title, weight: 1 },
    { text: playlist.artist ?? playlist.subtitle, weight: 0.7 },
  ]);

/**
 * Searches songs, albums, artists and playlists at once. Typos are tolerated only when nothing
 * matches exactly anywhere, so a real match is never buried under near misses.
 */
export function searchLibrary(index: LibraryIndex, query: string, stats?: PlayStats): LibraryResults {
  const tokens = tokenize(query);
  const empty: LibraryResults = { songs: [], albums: [], artists: [], playlists: [], total: 0, fuzzy: false };
  if (!tokens.length) return empty;
  const plays = (id: string) => stats?.get(id)?.plays ?? 0;
  const run = (fuzzy: boolean): LibraryResults => {
    const songs = rank(index.songs, tokens, fuzzy, (a, b) => plays(b.id) - plays(a.id));
    const albums = rank(index.albums, tokens, fuzzy, (a, b) => b.count - a.count);
    const artists = rank(index.artists, tokens, fuzzy, (a, b) => b.count - a.count);
    const playlists = rank(index.playlists, tokens, fuzzy);
    return { songs, albums, artists, playlists, total: songs.length + albums.length + artists.length + playlists.length, fuzzy };
  };
  const strict = run(false);
  return strict.total ? strict : run(true);
}

/* ---------- Sort options and their memory ---------- */

export interface SortOption<T extends string> {
  value: T;
  /** Full name in the menu. */
  label: string;
  /** Name on the chip. */
  short: string;
  hint?: string;
}
export const SONG_SORTS: SortOption<SongSort>[] = [
  { value: "recent", label: "Agregadas recientemente", short: "Recientes" },
  { value: "most-played", label: "Más escuchadas", short: "Más escuchadas" },
  { value: "last-played", label: "Escuchadas recientemente", short: "Recién escuchadas" },
  { value: "title", label: "Título A–Z", short: "Título" },
  { value: "artist", label: "Artista A–Z", short: "Artista" },
  { value: "album", label: "Álbum", short: "Álbum" },
  { value: "duration", label: "Duración", short: "Duración", hint: "De la más corta a la más larga" },
];
export const ALBUM_SORTS: SortOption<AlbumSort>[] = [
  { value: "recent", label: "Agregados recientemente", short: "Recientes" },
  { value: "most-played", label: "Más escuchados", short: "Más escuchados" },
  { value: "title", label: "Título A–Z", short: "Título" },
  { value: "artist", label: "Artista A–Z", short: "Artista" },
  { value: "count", label: "Número de canciones", short: "Nº de canciones" },
];
export const ARTIST_SORTS: SortOption<ArtistSort>[] = [
  { value: "most-played", label: "Más escuchados", short: "Más escuchados" },
  { value: "az", label: "A–Z", short: "A–Z" },
  { value: "count", label: "Número de canciones", short: "Nº de canciones" },
  { value: "last-played", label: "Escuchados recientemente", short: "Recién escuchados" },
];
export const PLAYLIST_SORTS: SortOption<PlaylistSort>[] = [
  { value: "recent", label: "Recientes", short: "Recientes", hint: "Abiertas o escuchadas hace poco" },
  { value: "az", label: "A–Z", short: "A–Z" },
  { value: "count", label: "Número de canciones", short: "Nº de canciones" },
];

export type SortCategory = "songs" | "downloads" | "albums" | "artists" | "playlists";
export const sortKey = (category: SortCategory) => "murmur.sort." + category;

/** The saved order of a category, or `fallback` when none (or an unknown one) is saved. */
export function loadSort<T extends string>(category: SortCategory, options: readonly SortOption<T>[], fallback: T): T {
  try {
    const saved = globalThis.localStorage?.getItem(sortKey(category));
    return options.find((option) => option.value === saved)?.value ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveSort(category: SortCategory, value: string) {
  try {
    globalThis.localStorage?.setItem(sortKey(category), value);
  } catch {
    /* No storage (private mode): the order lasts until the app closes. */
  }
}
