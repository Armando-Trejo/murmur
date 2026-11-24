import type { HistoryEntry, QueueItem, Source } from "./types";

export interface ArtistInsight { name: string; seconds: number; plays: number; trackId: string }
export interface TrackInsight { trackId: string; plays: number; seconds: number }
export interface DayInsight { key: string; label: string; seconds: number; today: boolean }
export interface Insights {
  totalSeconds: number;
  plays: number;
  distinctTracks: number;
  distinctArtists: number;
  skipRate: number;
  topArtists: ArtistInsight[];
  topTracks: TrackInsight[];
  sources: Record<Source, number>;
  streak: number;
  favoriteHour?: number;
  daily: DayInsight[];
}

const DAY = 86_400_000;
const weekday = ["D", "L", "M", "X", "J", "V", "S"];
const unknownArtist = /^(artista por identificar|unknown artist|various artists)$/i;

export function dayKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** History stores the position at which a track was left; bound it by the track length. */
export function listenedSeconds(entry: HistoryEntry, track?: QueueItem) {
  if (!Number.isFinite(entry.seconds) || entry.seconds <= 0) return 0;
  const limit = track && track.duration > 0 ? track.duration : 7200;
  return Math.min(entry.seconds, limit);
}

export function primaryArtist(track?: QueueItem) {
  const name = track?.artist.split(", ")[0]?.trim();
  return name && !unknownArtist.test(name) ? name : undefined;
}

/**
 * Summarises local listening. `rangeDays` limits the window to the last N calendar days
 * (today included); `null` covers the whole history. Nothing leaves the device.
 */
export function computeInsights(
  history: HistoryEntry[],
  tracks: Map<string, QueueItem>,
  now = Date.now(),
  rangeDays: number | null = 7,
): Insights {
  const from = rangeDays ? startOfDay(now) - (rangeDays - 1) * DAY : -Infinity;
  const inRange = history.filter(entry => Number.isFinite(entry.at) && entry.at >= from && entry.at <= now + DAY);
  const artists = new Map<string, ArtistInsight>();
  const songs = new Map<string, TrackInsight>();
  const hours = new Array<number>(24).fill(0);
  const sources: Record<Source, number> = { spotify: 0, youtube: 0 };
  let totalSeconds = 0;
  let plays = 0;
  let skips = 0;
  for (const entry of inRange) {
    const track = tracks.get(entry.trackId);
    const seconds = listenedSeconds(entry, track);
    totalSeconds += seconds;
    if (entry.skipped && seconds < 30) skips++;
    if (track && seconds > 0) sources[track.source] += seconds;
    hours[new Date(entry.at).getHours()] += seconds;
    if (seconds < 30) continue;
    plays++;
    const song = songs.get(entry.trackId) ?? { trackId: entry.trackId, plays: 0, seconds: 0 };
    song.plays++;
    song.seconds += seconds;
    songs.set(entry.trackId, song);
    const name = primaryArtist(track);
    if (!name) continue;
    const key = name.toLocaleLowerCase("es");
    const artist = artists.get(key) ?? { name, seconds: 0, plays: 0, trackId: entry.trackId };
    artist.plays++;
    artist.seconds += seconds;
    artists.set(key, artist);
  }
  const bySeconds = (a: { seconds: number; plays: number }, b: { seconds: number; plays: number }) =>
    b.plays - a.plays || b.seconds - a.seconds;
  const favorite = hours.reduce((best, value, hour) => (value > hours[best] ? hour : best), 0);
  const perDay = new Map<string, number>();
  for (const entry of history) {
    const seconds = listenedSeconds(entry, tracks.get(entry.trackId));
    if (seconds > 0) perDay.set(dayKey(entry.at), (perDay.get(dayKey(entry.at)) ?? 0) + seconds);
  }
  const today = startOfDay(now);
  let cursor = (perDay.get(dayKey(today)) ?? 0) >= 30 ? today : today - DAY;
  let streak = 0;
  // Step back by calendar day; going through noon keeps daylight-saving changes harmless.
  while ((perDay.get(dayKey(cursor + DAY / 2)) ?? 0) >= 30) {
    streak++;
    cursor = startOfDay(cursor - DAY / 2);
  }
  const daily = Array.from({ length: 7 }, (_, index) => {
    const at = startOfDay(today - (6 - index) * DAY + DAY / 2);
    const key = dayKey(at);
    return { key, label: weekday[new Date(at).getDay()], seconds: perDay.get(key) ?? 0, today: index === 6 };
  });
  return {
    totalSeconds,
    plays,
    distinctTracks: songs.size,
    distinctArtists: artists.size,
    skipRate: inRange.length ? skips / inRange.length : 0,
    topArtists: [...artists.values()].sort(bySeconds).slice(0, 5),
    topTracks: [...songs.values()].sort(bySeconds).slice(0, 5),
    sources,
    streak,
    favoriteHour: hours[favorite] > 0 ? favorite : undefined,
    daily,
  };
}

export function formatListening(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return seconds > 0 ? "< 1 min" : "0 min";
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function hourRange(hour: number) {
  const label = (value: number) => String(value % 24).padStart(2, "0");
  return `${label(hour)}–${label(hour + 1)} h`;
}

export function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}
