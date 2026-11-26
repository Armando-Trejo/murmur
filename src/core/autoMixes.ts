import { Audio, Auth, Voice, isNative } from "../native";
import { tasteHistory } from "./tasteGuard";
import { db } from "./db";
import { normalize } from "./FanUploadParser";
import { creditedArtists } from "../components/ArtistProfile";
import { unwrapSpotifyTrack } from "./SpotifyLibrary";
import { generateBlendMixes, songKey } from "./blendMixes";
import type { HistoryEntry, Playlist, QueueItem } from "./types";

/**
 * "Hecho para ti": playlists MURMUR keeps up to date by itself.
 *
 * - Descubrimiento diario: 10 songs you have never played or saved, renewed every day.
 * - Descubrimiento semanal: 20 songs, renewed every Monday, never repeating the daily ones.
 * - Mezclas MURMUR (blendMixes.ts), refreshed twice a day.
 *
 * It learns from what you do: full listens and saves raise an artist, quick skips lower it, and a
 * skipped recommendation stops that artist from being suggested again soon. Candidates come from the
 * providers' algorithms (YouTube Music radio after your songs, Spotify's catalogue around related
 * artists); the on-device sentence model, when downloaded, ranks them against your taste.
 */

export const DAILY_ID = "auto:discover-daily";
export const WEEKLY_ID = "auto:discover-weekly";
export const AUTO_PREFIX = "auto:";
const STATE_KEY = "auto:state:v1";

interface AutoState {
  daily?: string; // day key of the last daily build
  weekly?: string; // week key of the last weekly build
  blends?: number; // time of the last blend refresh
  /** Every song ever recommended, with the day it was suggested, to learn from what happened next. */
  suggested: Record<string, { at: number; artist: string }>;
}

export const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
/** Monday-based week key, so the weekly discovery renews at the start of each week. */
export function weekKey(date = new Date()) {
  const monday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return "w" + monday.toISOString().slice(0, 10);
}

const artistKey = (artist: string) => normalize(creditedArtists(artist)[0] ?? artist);

/** Taste per artist from listening, saves and how past recommendations went. */
export function tasteProfile(allHistory: HistoryEntry[], library: QueueItem[], suggested: AutoState["suggested"]) {
  const byId = new Map(library.map((t) => [t.id, t]));
  // Tests, guests and one-off requests outside your taste do not count (see tasteGuard).
  const history = tasteHistory(allHistory, library, suggested);
  const weight = new Map<string, number>();
  const add = (artist: string, value: number) => {
    const key = artistKey(artist);
    if (key) weight.set(key, (weight.get(key) ?? 0) + value);
  };
  const now = Date.now();
  for (const entry of history) {
    const track = byId.get(entry.trackId);
    if (!track) continue;
    // Recent behaviour counts more: half weight after ~6 weeks.
    const age = Math.max(0, now - entry.at) / (42 * 86_400_000);
    const recency = 1 / (1 + age);
    const recommended = suggested[entry.trackId];
    if (entry.skipped && entry.seconds < 30) add(track.artist, (recommended ? -3 : -1.5) * recency);
    else if (entry.seconds >= 60) add(track.artist, (recommended ? 2.5 : 1) * recency);
  }
  for (const track of library) if (track.saved) add(track.artist, 2);
  return weight;
}

async function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  try { return await promise; } catch { return undefined; }
}

const spotifyTracks = (items: unknown) =>
  (Array.isArray(items) ? items : []).map(unwrapSpotifyTrack).filter((t): t is QueueItem => !!t);

/** Picks songs by score, at most `perArtist` per artist, never two in a row by the same artist. */
export function pickDiscoveries(scored: { track: QueueItem; score: number }[], count: number, perArtist: number, exclude: Set<string>) {
  const out: QueueItem[] = [];
  const perCount = new Map<string, number>();
  const seen = new Set(exclude);
  for (const { track } of [...scored].sort((a, b) => b.score - a.score)) {
    if (out.length >= count) break;
    const key = songKey(track);
    const artist = artistKey(track.artist);
    if (seen.has(key) || (perCount.get(artist) ?? 0) >= perArtist) continue;
    seen.add(key);
    perCount.set(artist, (perCount.get(artist) ?? 0) + 1);
    out.push(track);
  }
  // Spread artists: move a song down when it follows its own artist.
  for (let i = 1; i < out.length; i++) {
    if (artistKey(out[i].artist) !== artistKey(out[i - 1].artist)) continue;
    const swap = out.findIndex((t, j) => j > i && artistKey(t.artist) !== artistKey(out[i - 1].artist));
    if (swap > 0) [out[i], out[swap]] = [out[swap], out[i]];
  }
  return out;
}

async function candidates(weight: Map<string, number>, library: QueueItem[], history: HistoryEntry[]) {
  const favourites = [...weight.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const disliked = new Set([...weight.entries()].filter(([, w]) => w <= -3).map(([a]) => a));
  const names = new Map(library.map((t) => [artistKey(t.artist), creditedArtists(t.artist)[0] ?? t.artist]));
  const topNames = favourites.slice(0, 6).map((a) => names.get(a) ?? a);

  // Related artists you do not play yet (Deezer's graph through the native lookup).
  const related = new Map<string, number>();
  for (const [rank, name] of topNames.entries()) {
    const info = await settle(Audio.lookupArtist({ artist: name }));
    for (const other of info?.related ?? []) {
      const key = artistKey(other);
      if (!weight.has(key) && !disliked.has(key)) related.set(other, (related.get(other) ?? 0) + (6 - rank));
    }
  }
  const relatedNames = [...related.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 8);

  // YouTube Music's radio after your most played YouTube songs.
  const stats = new Map<string, number>();
  for (const h of history) if (h.seconds >= 60) stats.set(h.trackId, (stats.get(h.trackId) ?? 0) + 1);
  const seeds = library.filter((t) => t.videoId && stats.get(t.id)).sort((a, b) => (stats.get(b.id) ?? 0) - (stats.get(a.id) ?? 0))
    .filter((t, i, all) => all.findIndex((x) => artistKey(x.artist) === artistKey(t.artist)) === i).slice(0, 3);
  const radio = (await Promise.all(seeds.map(async (seed) =>
    (await settle(Auth.youtubeCollection({ id: "RDAMVM" + seed.videoId })))?.tracks ?? []))).flat();

  // Spotify's catalogue for the related artists, and YouTube Music songs for the same names.
  const fromSpotify = (await Promise.all(relatedNames.slice(0, 6).map(async (name) =>
    spotifyTracks((await settle(Auth.spotifyRequest({ path: "/search?type=track&limit=5&q=" + encodeURIComponent(`artist:"${name}"`) })))?.data?.tracks?.items)))).flat();
  const fromYouTube = (await Promise.all(relatedNames.slice(0, 4).map(async (name) =>
    ((await settle(Auth.youtubeSongs({ query: name })))?.songs ?? []).slice(0, 4).map((s): QueueItem => ({
      id: "yt:" + s.videoId, videoId: s.videoId, source: "youtube", title: s.title, artist: s.artist || name,
      duration: s.duration > 0 ? s.duration : 0, artworkUrl: s.artworkUrl, tags: [],
    }))))).flat();

  return { radio, fromSpotify, fromYouTube, related, relatedNames, disliked, topNames };
}

/** The local sentence model, when installed, rates how close each candidate sits to your taste. */
async function semanticScores(topNames: string[], pool: QueueItem[]) {
  const scores = new Map<string, number>();
  if (!topNames.length || !pool.length) return scores;
  const ranked = await settle(Voice.rankTags({
    query: "música como " + topNames.slice(0, 6).join(", "),
    tags: pool.slice(0, 200).map((t) => `${creditedArtists(t.artist)[0] ?? t.artist} — ${t.title}`),
  }));
  ranked?.ranked?.forEach(({ text, score }) => scores.set(text, score));
  return scores;
}

async function buildDiscoveries(state: AutoState, wantDaily: boolean, wantWeekly: boolean) {
  const [history, library] = await Promise.all([db.history.toArray(), db.tracks.toArray()]);
  const weight = tasteProfile(history, library, state.suggested);
  const { radio, fromSpotify, fromYouTube, related, disliked, topNames } = await candidates(weight, library, tasteHistory(history, library, state.suggested));
  const known = new Set([
    ...library.filter((t) => t.saved).map(songKey),
    ...history.map((h) => library.find((t) => t.id === h.trackId)).filter((t): t is QueueItem => !!t).map(songKey),
  ]);
  const pool = [...radio, ...fromSpotify, ...fromYouTube].filter((t) => !disliked.has(artistKey(t.artist)) && !known.has(songKey(t)));
  if (!pool.length) return {};
  const semantic = await semanticScores(topNames, pool);
  const inRadio = new Set(radio.map(songKey));
  const relatedKeys = new Map([...related.entries()].map(([n, w]) => [artistKey(n), w]));
  const maxRelated = Math.max(1, ...relatedKeys.values());
  const recentlySuggested = new Set(Object.entries(state.suggested).filter(([, s]) => Date.now() - s.at < 21 * 86_400_000).map(([id]) => id));
  const scored = pool.map((track) => {
    const key = artistKey(track.artist);
    const label = `${creditedArtists(track.artist)[0] ?? track.artist} — ${track.title}`;
    const score =
      (inRadio.has(songKey(track)) ? 0.35 : 0) + // YouTube's own algorithm chose it after your songs
      0.3 * ((relatedKeys.get(key) ?? 0) / maxRelated) + // close to artists you love
      0.25 * (semantic.get(label) ?? 0.3) + // the local model's opinion
      0.1 * Math.min(1, Math.max(0, weight.get(key) ?? 0) / 5) - // a little familiarity
      (recentlySuggested.has(track.id) ? 0.5 : 0) + // keep it fresh
      Math.random() * 0.05; // small variety between days
    return { track, score };
  });
  const daily = wantDaily ? pickDiscoveries(scored, 10, 1, new Set()) : undefined;
  const weekly = wantWeekly ? pickDiscoveries(scored, 20, 2, new Set((daily ?? []).map(songKey))) : undefined;
  return { daily, weekly };
}

async function savePlaylist(id: string, title: string, subtitle: string, tracks: QueueItem[]) {
  const playlist: Playlist = {
    id, title, subtitle, source: "hybrid", kind: "playlist",
    trackIds: tracks.map((t) => t.id),
    artworkUrl: tracks.find((t) => t.artworkUrl)?.artworkUrl,
  };
  await db.transaction("rw", db.tracks, db.playlists, async () => {
    for (const track of tracks) {
      const existing = await db.tracks.get(track.id);
      await db.tracks.put({ ...track, ...existing, tags: existing?.tags ?? track.tags ?? [], saved: existing?.saved ?? false });
    }
    await db.playlists.put(playlist);
  });
}

let running: Promise<void> | undefined;

/**
 * Renews whatever is due: the daily discovery once per day, the weekly one once per week, the blends
 * twice a day. Cheap when nothing is due. `force` rebuilds everything (the refresh button).
 */
export function refreshAutoMixes(force = false) {
  running ??= (async () => {
    try {
      if (!isNative) return;
      // Retire the fixed mixes of the first versions; these playlists replace them.
      await db.playlists.bulkDelete(["local:mix:daily", "local:mix:bridge", "local:mix:radar"]).catch(() => {});
      const state = ((await db.settings.get(STATE_KEY))?.value as AutoState | undefined) ?? { suggested: {} };
      const wantDaily = force || state.daily !== dayKey();
      const wantWeekly = force || state.weekly !== weekKey();
      if (wantDaily || wantWeekly) {
        const { daily, weekly } = await buildDiscoveries(state, wantDaily, wantWeekly);
        const now = Date.now();
        if (daily?.length) {
          await savePlaylist(DAILY_ID, "Descubrimiento diario", "10 canciones nuevas para ti · se renueva cada día", daily);
          state.daily = dayKey();
          daily.forEach((t) => (state.suggested[t.id] = { at: now, artist: t.artist }));
        }
        if (weekly?.length) {
          await savePlaylist(WEEKLY_ID, "Descubrimiento semanal", "20 canciones nuevas · se renueva cada lunes", weekly);
          state.weekly = weekKey();
          weekly.forEach((t) => (state.suggested[t.id] = { at: now, artist: t.artist }));
        }
        // Forget suggestions older than 90 days.
        for (const [id, s] of Object.entries(state.suggested)) if (now - s.at > 90 * 86_400_000) delete state.suggested[id];
      }
      if (force || !state.blends || Date.now() - state.blends > 12 * 3_600_000) {
        const blends = await settle(generateBlendMixes(force));
        if (blends?.length) {
          const keep = new Set<string>();
          for (const mix of blends) {
            const id = AUTO_PREFIX + mix.id;
            keep.add(id);
            await savePlaylist(id, mix.title, mix.subtitle, mix.tracks);
          }
          // Drop blends that no longer exist (a circle of artists that changed).
          const stale = (await db.playlists.toArray()).filter((p) => p.id.startsWith(AUTO_PREFIX + "blend-") && !keep.has(p.id)).map((p) => p.id);
          if (stale.length) await db.playlists.bulkDelete(stale);
          state.blends = Date.now();
        }
      }
      await db.settings.put({ key: STATE_KEY, value: state });
    } finally {
      running = undefined;
    }
  })();
  return running;
}
