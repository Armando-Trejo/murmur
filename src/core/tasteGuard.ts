import { normalize } from "./FanUploadParser";
import { creditedArtists } from "../components/ArtistProfile";
import type { HistoryEntry, QueueItem } from "./types";

/**
 * Keeps "your algorithm" yours. A song from an artist outside your taste (a test, a friend's
 * request, a party) is remembered in the history but does not teach MURMUR anything, unless it
 * turns into a real new taste: you save it, or you come back to that artist on different days.
 * Listening with «Modo invitado» on never teaches anything (a ♥ still counts: it is explicit).
 */
const DAY = 86_400_000;
/** Distinct days with a real listen (≥ 60 s) that make an artist part of your taste. */
export const NEW_TASTE_DAYS = 3;
/** …or this many different songs of the artist, on at least two days. */
export const NEW_TASTE_SONGS = 2;
/** Only recent returns make a new taste: an artist heard once a month ago and once today is not one. */
export const NEW_TASTE_WINDOW_DAYS = 45;
const REAL_LISTEN_S = 60;

const artistKey = (artist: string) => normalize(creditedArtists(artist)[0] ?? artist);
const dayOf = (at: number) => Math.floor(at / DAY);

export interface TasteVerdict {
  /** Entries that may shape taste, recommendations and mixes. */
  trusted: HistoryEntry[];
  /** Artists that are part of your taste (normalised names). */
  established: Set<string>;
  /** Artists heard recently that did not (yet) become a taste: tests, guests, one-offs. */
  outsiders: Set<string>;
}

export function judgeHistory(
  history: HistoryEntry[],
  library: QueueItem[],
  { suggested = {}, now = Date.now() }: { suggested?: Record<string, unknown>; now?: number } = {},
): TasteVerdict {
  const byId = new Map(library.map((t) => [t.id, t]));
  const established = new Set<string>();
  // What you chose to keep: saved songs and your synced favourites.
  for (const t of library)
    if (!t.deleted && !t.unliked && (t.saved || t.tags?.includes("top"))) established.add(artistKey(t.artist));

  // Real returns to an artist, outside guest mode.
  const since = now - NEW_TASTE_WINDOW_DAYS * DAY;
  const days = new Map<string, Set<number>>();
  const songs = new Map<string, Map<string, Set<number>>>();
  const everyDay = new Map<string, Set<number>>();
  for (const entry of history) {
    if (entry.guest || entry.seconds < REAL_LISTEN_S) continue;
    const track = byId.get(entry.trackId);
    if (!track) continue;
    const artist = artistKey(track.artist);
    if (!artist) continue;
    const day = dayOf(entry.at);
    if (!everyDay.has(artist)) everyDay.set(artist, new Set());
    everyDay.get(artist)!.add(day);
    if (entry.at < since) continue;
    if (!days.has(artist)) days.set(artist, new Set());
    days.get(artist)!.add(day);
    if (!songs.has(artist)) songs.set(artist, new Map());
    const perSong = songs.get(artist)!;
    if (!perSong.has(track.id)) perSong.set(track.id, new Set());
    perSong.get(track.id)!.add(day);
  }
  for (const [artist, set] of everyDay) {
    // A long-standing habit (many days over time) is taste even if it is not recent.
    if (set.size >= NEW_TASTE_DAYS * 2) established.add(artist);
  }
  for (const [artist, set] of days) {
    if (set.size >= NEW_TASTE_DAYS) { established.add(artist); continue; }
    const perSong = songs.get(artist)!;
    if (perSong.size >= NEW_TASTE_SONGS && set.size >= 2) established.add(artist);
  }

  const trusted: HistoryEntry[] = [];
  const outsiders = new Set<string>();
  for (const entry of history) {
    const track = byId.get(entry.trackId);
    if (!track) continue;
    const artist = artistKey(track.artist);
    const saved = !!track.saved && !track.unliked && !track.deleted;
    if (entry.guest && !saved) { outsiders.add(artist); continue; }
    // MURMUR's own recommendations are how new tastes are found: their listens and skips count.
    if (established.has(artist) || saved || suggested[entry.trackId]) { trusted.push(entry); continue; }
    outsiders.add(artist);
  }
  for (const artist of established) outsiders.delete(artist);
  return { trusted, established, outsiders };
}

/** The history entries that may teach MURMUR your taste. */
export const tasteHistory = (history: HistoryEntry[], library: QueueItem[], suggested?: Record<string, unknown>) =>
  judgeHistory(history, library, { suggested }).trusted;

const GUEST_KEY = "murmur.guestUntil";
/** «Modo invitado»: what plays meanwhile does not change your taste. Turns itself off. */
export const GUEST_HOURS = 3;
export function guestModeUntil(now = Date.now()) {
  if (typeof localStorage === "undefined") return 0;
  const until = Number(localStorage.getItem(GUEST_KEY) || 0);
  return until > now ? until : 0;
}
export const guestModeOn = (now = Date.now()) => guestModeUntil(now) > 0;
export function setGuestMode(on: boolean, now = Date.now()) {
  if (typeof localStorage === "undefined") return;
  if (on) localStorage.setItem(GUEST_KEY, String(now + GUEST_HOURS * 3_600_000));
  else localStorage.removeItem(GUEST_KEY);
}
