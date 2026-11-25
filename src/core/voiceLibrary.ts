import { db } from "./db";
import { normalize, stripTitleNoise } from "./FanUploadParser";
import { listeningStats } from "./musicOrder";
import type { HistoryEntry, Playlist, QueueItem } from "./types";
import { phraseScore, skeleton, songScore, tokens, wordKey, wordSimilarity, type Tok } from "./voicePhonetics";

/**
 * The owner's own music (every song played or saved, the albums and playlists, how often each one
 * plays), indexed by sound so a spoken request lands on what the owner means before any catalogue
 * is asked: "pon de misfits" is the Misfits of the library, not some song called "Misfits".
 */

export type Want = "any" | "song" | "artist" | "album" | "playlist";
interface HitBase { score: number; base: number; label: string; key: string }
export type LibraryHit =
  | (HitBase & { kind: "track"; track: QueueItem })
  | (HitBase & { kind: "artist"; name: string; songs: number })
  | (HitBase & { kind: "album"; title: string; artist: string; playlistId?: string; artworkUrl?: string; tracks: QueueItem[] })
  | (HitBase & { kind: "playlist"; id: string; title: string });

interface TrackEntry { kind: "track"; item: QueueItem; titles: Tok[][]; artist: Tok[]; plays: number }
interface ArtistEntry { kind: "artist"; name: string; names: Map<string, number>; toks: Tok[]; songs: number; plays: number }
interface AlbumEntry { kind: "album"; title: string; artist: string; toks: Tok[]; artistToks: Tok[]; playlistId?: string; artworkUrl?: string; tracks: QueueItem[] }
interface PlaylistEntry { kind: "playlist"; id: string; title: string; toks: Tok[] }
type Entry = TrackEntry | ArtistEntry | AlbumEntry | PlaylistEntry;

export interface VoiceLibrary {
  entries: Entry[];
  /** Sound key → entries that contain it. */
  byKey: Map<string, number[]>;
  /** Sound key → the word as the library spells it (for a corrected catalogue query). */
  vocab: Map<string, { word: string; tok: Tok; count: number }>;
  plays: Record<string, number>;
  /** Sound keys of every artist in the library (whole names and each collaborator). */
  artistKeys: Set<string>;
}

/** Artist line without YouTube's "- Topic" and "VEVO" channel decorations. */
export const artistLine = (artist: string) => artist.replace(/\s*-\s*topic\s*$/i, "").replace(/(?<=\S)vevo\s*$/i, "").trim();
/** Collaborations only ("A, B", "A feat. B", "A x B"): "&", "and" and "y" are usually part of a band's name. */
export const collaborators = (artist: string) =>
  artistLine(artist).split(/\s*(?:,|;|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\s+x\s+)\s*/i).map((a) => a.trim()).filter(Boolean);

/** Title without "(Remastered 2011)", "[Official Video]", " - Live"…; YouTube's "Artist - Title" also gives "Title". */
export function titleVariants(title: string): string[] {
  const clean = stripTitleNoise(title)
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    .replace(/\s+[-–—]\s+(?:\d{4}\s+)?(?:remaster\w*|live|en vivo|version|versión|mono|stereo|single|radio|edit|demo|acoustic|bonus)\b.*$/i, "")
    .trim() || title;
  const parts = clean.split(/\s+[-–—|]\s+/);
  return parts.length === 2 ? [clean, parts[1]] : [clean];
}

const keyOf = (toks: Tok[]) => toks.map((t) => t.key).join(" ");

export function buildVoiceLibrary(tracks: QueueItem[], playlists: Playlist[] = [], history: HistoryEntry[] = []): VoiceLibrary {
  const stats = listeningStats(history);
  const plays: Record<string, number> = {};
  for (const [id, s] of Object.entries(stats)) plays[id] = s.plays;
  const entries: Entry[] = [];
  const artists = new Map<string, ArtistEntry>();
  const albums = new Map<string, AlbumEntry>();
  for (const item of tracks) {
    if (!item?.title || !item.artist) continue;
    const line = artistLine(item.artist);
    const artistToks = tokens(line);
    entries.push({ kind: "track", item, titles: titleVariants(item.title).map((t) => tokens(t)), artist: artistToks, plays: plays[item.id] ?? 0 });
    const names = [line, ...collaborators(line)];
    for (const name of new Set(names)) {
      const toks = tokens(name);
      const k = keyOf(toks);
      if (!k) continue;
      const a = artists.get(k) ?? { kind: "artist" as const, name, names: new Map<string, number>(), toks, songs: 0, plays: 0 };
      a.names.set(name, (a.names.get(name) ?? 0) + 1);
      a.songs++;
      a.plays += plays[item.id] ?? 0;
      artists.set(k, a);
    }
    if (item.album) {
      const lead = collaborators(line)[0] ?? line;
      const k = normalize(item.album) + "|" + keyOf(tokens(lead));
      const al = albums.get(k) ?? { kind: "album" as const, title: item.album, artist: lead, toks: tokens(titleVariants(item.album)[0]), artistToks: tokens(lead), artworkUrl: item.artworkUrl, tracks: [] };
      al.tracks.push(item);
      albums.set(k, al);
    }
  }
  for (const a of artists.values()) {
    // The spelling the library uses most ("The Misfits" over "Misfits" if that is what it says).
    a.name = [...a.names.entries()].sort((x, y) => y[1] - x[1])[0][0];
    entries.push(a);
  }
  const byId = new Map(tracks.map((t) => [t.id, t]));
  for (const p of playlists) {
    if (!p?.title) continue;
    if (p.kind === "album") {
      const artist = p.artist ?? "";
      const k = normalize(p.title) + "|" + keyOf(tokens(collaborators(artist)[0] ?? artist));
      const derived = albums.get(k);
      albums.set(k, {
        kind: "album", title: p.title, artist, toks: tokens(titleVariants(p.title)[0]), artistToks: tokens(collaborators(artist)[0] ?? artist),
        playlistId: p.id, artworkUrl: p.artworkUrl ?? derived?.artworkUrl,
        tracks: p.trackIds.map((id) => byId.get(id)).filter((t): t is QueueItem => !!t),
      });
    } else entries.push({ kind: "playlist", id: p.id, title: p.title, toks: tokens(p.title) });
  }
  entries.push(...albums.values());
  const byKey = new Map<string, number[]>();
  const vocab = new Map<string, { word: string; tok: Tok; count: number }>();
  const note = (toks: Tok[], index: number) => {
    for (const t of toks) {
      const list = byKey.get(t.key);
      if (!list) byKey.set(t.key, [index]);
      else if (list[list.length - 1] !== index) list.push(index);
      const v = vocab.get(t.key);
      if (!v) vocab.set(t.key, { word: t.word, tok: t, count: 1 });
      else v.count++;
    }
  };
  entries.forEach((e, i) => {
    if (e.kind === "track") { e.titles.forEach((t) => note(t, i)); note(e.artist, i); }
    else if (e.kind === "artist") note(e.toks, i);
    else if (e.kind === "album") { note(e.toks, i); note(e.artistToks, i); }
    else note(e.toks, i);
  });
  const artistKeys = new Set([...artists.keys()]);
  return { entries, byKey, vocab, plays, artistKeys };
}

/** Entries that share at least one word that sounds like a said word (the rest cannot match). */
function nearby(lib: VoiceLibrary, said: Tok[]): Set<number> {
  const probes: Pick<Tok, "key" | "skel">[] = [...said];
  for (let i = 0; i + 1 < said.length; i++) {
    const key = (said[i].key + said[i + 1].key).replace(/(.)\1+/g, "$1");
    probes.push({ key, skel: skeleton(key) });
  }
  const found = new Set<number>();
  for (const [key, { tok }] of lib.vocab) {
    const near = (p: Pick<Tok, "key" | "skel">) =>
      Math.min(p.key.length, key.length) * 2 >= Math.max(p.key.length, key.length) && wordSimilarity(p, tok) >= 0.72;
    if (!probes.some(near)) continue;
    for (const i of lib.byKey.get(key) ?? []) found.add(i);
  }
  return found;
}

const KIND_ORDER = { artist: 0, track: 1, playlist: 2, album: 3 } as const;
/** Best first; within 0.025 of each other an artist goes before a song, a song before a playlist or an album. */
export function compareHits(a: { base: number; score: number; kind: LibraryHit["kind"] }, b: { base: number; score: number; kind: LibraryHit["kind"] }, songFirst = false) {
  const bucket = Math.round(b.base * 40) - Math.round(a.base * 40);
  if (bucket) return bucket;
  const order = (k: LibraryHit["kind"]) => (songFirst && k === "track" ? -1 : KIND_ORDER[k]);
  return order(a.kind) - order(b.kind) || b.score - a.score;
}

/** What in the library the words name, best first (one hit per song, artist, album or playlist). */
export function matchLibrary(lib: VoiceLibrary, said: string, want: Want = "any", limit = 6): LibraryHit[] {
  const toks = tokens(said);
  if (!toks.length) return [];
  const hits: LibraryHit[] = [];
  const allow = (kind: Entry["kind"]) =>
    want === "any" || (want === "song" && kind === "track") || (want === "artist" && kind === "artist") || (want === "album" && kind === "album") || (want === "playlist" && kind === "playlist");
  for (const i of nearby(lib, toks)) {
    const e = lib.entries[i];
    if (!allow(e.kind)) continue;
    if (e.kind === "track") {
      const base = Math.max(...e.titles.map((t) => songScore(toks, t, e.artist)));
      if (base < 0.45) continue;
      const bonus = base >= 0.6 ? Math.min(0.04, 0.012 * Math.log2(1 + e.plays)) + (e.item.saved ? 0.01 : 0) : 0;
      hits.push({ kind: "track", track: e.item, base, score: Math.min(1, base + bonus), label: `${e.item.title} · ${e.item.artist}`, key: "t:" + e.item.id });
    } else if (e.kind === "artist") {
      const base = phraseScore(toks, e.toks, 0.75);
      if (base < 0.45) continue;
      const bonus = base >= 0.6 ? Math.min(0.04, 0.008 * Math.log2(1 + e.songs + e.plays)) : 0;
      hits.push({ kind: "artist", name: e.name, songs: e.songs, base, score: Math.min(1, base + bonus), label: e.name, key: "a:" + keyOf(e.toks) });
    } else if (e.kind === "album") {
      const base = songScore(toks, e.toks, e.artistToks);
      if (base < 0.45) continue;
      const bonus = base >= 0.6 ? (e.playlistId ? 0.02 : 0) + Math.min(0.02, 0.005 * e.tracks.length) : 0;
      hits.push({ kind: "album", title: e.title, artist: e.artist, playlistId: e.playlistId, artworkUrl: e.artworkUrl, tracks: e.tracks, base, score: Math.min(1, base + bonus), label: `${e.title} · ${e.artist}`, key: "l:" + normalize(e.title) + "|" + keyOf(e.artistToks) });
    } else {
      const base = phraseScore(toks, e.toks, 0.7);
      if (base < 0.45) continue;
      hits.push({ kind: "playlist", id: e.id, title: e.title, base, score: Math.min(1, base + (base >= 0.6 ? 0.01 : 0)), label: e.title, key: "p:" + e.id });
    }
  }
  hits.sort((a, b) => compareHits(a, b, want === "song"));
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.key) && !!seen.add(h.key)).slice(0, limit);
}

/** True when a track's artist line is (or credits) the artist named. */
export function byArtist(track: Pick<QueueItem, "artist">, name: string) {
  const wanted = tokens(name);
  if (phraseScore(wanted, tokens(artistLine(track.artist)), 1) >= 0.85) return true;
  return collaborators(track.artist).some((a) => phraseScore(wanted, tokens(a), 1) >= 0.88);
}

/** The owner's songs by an artist, most played first. */
export function librarySongsBy(lib: VoiceLibrary, name: string): QueueItem[] {
  return lib.entries
    .filter((e): e is TrackEntry => e.kind === "track" && byArtist(e.item, name))
    .sort((a, b) => b.plays - a.plays || Number(!!b.item.saved) - Number(!!a.item.saved))
    .map((e) => e.item);
}

/**
 * The words said, each one spelled the way the library spells the word it sounds like
 * ("kin guisar" → "king gizzard"): a better query for the catalogues. Undefined when nothing changes.
 */
export function correctQuery(lib: VoiceLibrary, said: string): string | undefined {
  const words = normalize(said).split(" ").filter(Boolean);
  let changed = false;
  const out = words.map((word) => {
    if (/^\d+$/.test(word) || word.length < 3) return word;
    const key = wordKey(word);
    const exact = lib.vocab.get(key);
    if (exact) {
      if (exact.word !== word) changed = true;
      return exact.word;
    }
    const probe = { key, skel: skeleton(key) };
    let best: { word: string; sim: number; count: number } | undefined;
    for (const v of lib.vocab.values()) {
      const sim = wordSimilarity(probe, v.tok);
      if (sim >= 0.86 && (!best || sim > best.sim || (sim === best.sim && v.count > best.count))) best = { word: v.word, sim, count: v.count };
    }
    if (!best) return word;
    changed = true;
    return best.word;
  });
  return changed ? out.join(" ") : undefined;
}

/** True when the artist (or one of the credited ones) is in the owner's library. */
export function knowsArtist(lib: VoiceLibrary, artist: string) {
  return [artistLine(artist), ...collaborators(artist)].some((name) => lib.artistKeys.has(keyOf(tokens(name))));
}

/**
 * Names the speech recognizer should expect, most relevant first: the artists listened to most, the
 * saved and most played songs, the albums and the playlists.
 */
export function hintNames(lib: VoiceLibrary, limits = { artists: 170, songs: 170, albums: 70, playlists: 60 }) {
  const songs = lib.entries
    .filter((e): e is TrackEntry => e.kind === "track" && (e.plays > 0 || !!e.item.saved))
    .sort((a, b) => b.plays + (b.item.saved ? 2 : 0) - (a.plays + (a.item.saved ? 2 : 0)))
    .map((e) => titleVariants(e.item.title).at(-1)!);
  const albums = lib.entries
    .filter((e): e is AlbumEntry => e.kind === "album")
    .sort((a, b) => Number(!!b.playlistId) - Number(!!a.playlistId) || b.tracks.length - a.tracks.length)
    .map((e) => titleVariants(e.title)[0]);
  const playlists = lib.entries.filter((e): e is PlaylistEntry => e.kind === "playlist").map((e) => e.title);
  const fit = (list: string[], n: number) => [...new Set(list.map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 50))].slice(0, n);
  return {
    artists: fit(topArtists(lib, limits.artists * 2), limits.artists),
    songs: fit(songs, limits.songs),
    albums: fit(albums, limits.albums),
    playlists: fit(playlists, limits.playlists),
  };
}

/** The artists the owner listens to most (saved songs and plays count), for the recognizer's hints. */
export function topArtists(lib: VoiceLibrary, limit: number): string[] {
  return lib.entries
    .filter((e): e is ArtistEntry => e.kind === "artist")
    .sort((a, b) => b.songs + b.plays * 2 - (a.songs + a.plays * 2))
    .slice(0, limit)
    .map((a) => a.name);
}

function safe<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return read().catch(() => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}

let cache: { at: number; signature: string; lib: VoiceLibrary } | undefined;
/** The library index, rebuilt when the library changes (or every few minutes). */
export async function loadVoiceLibrary(): Promise<VoiceLibrary> {
  const counts = await Promise.all([
    safe(() => db.tracks.count(), -1), safe(() => db.playlists.count(), -1), safe(() => db.history.count(), -1),
  ]);
  const signature = counts.join(":");
  if (cache && !counts.includes(-1) && cache.signature === signature && Date.now() - cache.at < 5 * 60_000) return cache.lib;
  const [tracks, playlists, history] = await Promise.all([
    safe(() => db.tracks.toArray(), [] as QueueItem[]),
    safe(() => db.playlists.toArray(), [] as Playlist[]),
    safe(() => db.history.toArray(), [] as HistoryEntry[]),
  ]);
  const lib = buildVoiceLibrary(tracks ?? [], playlists ?? [], history ?? []);
  cache = { at: Date.now(), signature, lib };
  return lib;
}
