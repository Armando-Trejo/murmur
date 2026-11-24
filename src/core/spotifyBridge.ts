import { Auth, isNative } from "../native";
import { db } from "./db";
import { normalize } from "./FanUploadParser";
import { similarity } from "./SourceResolver";
import { creditedArtists } from "../components/ArtistProfile";
import type { QueueItem } from "./types";

/**
 * Spotify on this phone refuses audio to third-party players (librespot "audio key" refusals, an
 * account-level block reported upstream) and its Web player has no DRM in Android WebView. MURMUR
 * must not depend on the Spotify app, so a Spotify track can play its YouTube Music twin through
 * MURMUR's own engine: same title, same artist, length within a few seconds.
 */
export interface YouTubeSong {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  artworkUrl?: string;
}

const VIA_KEY = "murmur.spotifyVia";
/** "youtube" once Spotify refused playback here; cleared to try Spotify's own engines again. */
export const spotifyViaYouTube = () => typeof localStorage !== "undefined" && localStorage.getItem(VIA_KEY) === "youtube";
export function setSpotifyViaYouTube(value: boolean) {
  if (value) localStorage.setItem(VIA_KEY, "youtube");
  else localStorage.removeItem(VIA_KEY);
}

const cleanTitle = (title: string) =>
  title
    .replace(/\s*[([](?:feat|ft|with|con)\.?\s[^)\]]*[)\]]/gi, "")
    .replace(/\s+-\s+(?:remaster(?:ed)?|\d{4} remaster|live|en vivo|radio edit|single version)[^-]*$/i, "")
    .replace(/\s*[([][^)\]]*(?:remaster|version|versión)[^)\]]*[)\]]/gi, "")
    .trim();

/** 0..1: how surely a YouTube Music song is the same recording as the Spotify track. */
export function twinScore(track: Pick<QueueItem, "title" | "artist" | "duration">, song: YouTubeSong) {
  const title = similarity(cleanTitle(track.title), cleanTitle(song.title));
  const wanted = creditedArtists(track.artist).map(normalize);
  const got = creditedArtists(song.artist).map(normalize);
  const artist = wanted.some((a) => got.includes(a)) ? 1 : Math.max(0, ...wanted.flatMap((a) => got.map((b) => similarity(a, b))));
  let length = 0.6;
  if (track.duration > 0 && song.duration > 0) {
    const gap = Math.abs(track.duration - song.duration);
    length = gap <= 3 ? 1 : gap <= 8 ? 0.8 : gap <= 20 ? 0.4 : 0;
  }
  // Live or alternate cuts the Spotify title does not ask for are a different recording.
  const unwanted = /\b(live|en vivo|cover|karaoke|remix|instrumental|sped up|slowed)\b/i;
  const penalty = unwanted.test(song.title) && !unwanted.test(track.title) ? 0.35 : 0;
  return Math.max(0, title * 0.45 + artist * 0.35 + length * 0.2 - penalty);
}

export function pickTwin(track: Pick<QueueItem, "title" | "artist" | "duration">, songs: YouTubeSong[]) {
  let best: YouTubeSong | undefined;
  let score = 0;
  for (const song of songs) {
    const s = twinScore(track, song);
    if (s > score) { score = s; best = song; }
  }
  return score >= 0.72 ? best : undefined;
}

const memory = new Map<string, YouTubeSong | null>();

/** YouTube Music twin of a Spotify track, cached on the device (null means "no safe match"). */
export async function youtubeTwin(track: QueueItem): Promise<YouTubeSong | undefined> {
  if (!isNative) return;
  if (memory.has(track.id)) return memory.get(track.id) ?? undefined;
  const key = "twin:v1:" + track.id;
  const cached = await db.settings.get(key);
  if (cached) {
    memory.set(track.id, cached.value as YouTubeSong | null);
    return (cached.value as YouTubeSong | null) ?? undefined;
  }
  const query = [cleanTitle(track.title), creditedArtists(track.artist)[0] ?? track.artist].filter(Boolean).join(" ");
  const { songs } = await Auth.youtubeSongs({ query });
  const twin = pickTwin(track, songs ?? []) ?? null;
  memory.set(track.id, twin);
  await db.settings.put({ key, value: twin }).catch(() => {});
  return twin ?? undefined;
}

/**
 * The queue entry played from YouTube Music: same queue identity and Spotify metadata, YouTube
 * audio. `bridged` keeps the Spotify origin for the UI and for switching back later.
 */
export function bridged(track: QueueItem, twin: YouTubeSong): QueueItem {
  return {
    ...track,
    source: "youtube",
    videoId: twin.videoId,
    duration: track.duration || twin.duration,
    artworkUrl: track.artworkUrl || twin.artworkUrl,
    bridgedFrom: "spotify",
  };
}
