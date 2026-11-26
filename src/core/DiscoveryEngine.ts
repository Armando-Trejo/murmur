import { Audio, Auth, isNative } from "../native";
import { db } from "./db";
import { mergeSyncedTrack } from "./libraryEdit";
import { parseFanUpload, normalize, stripTitleNoise } from "./FanUploadParser";
import { similarity } from "./SourceResolver";
import type { QueueItem } from "./types";
import { guestModeOn } from "./tasteGuard";
export function hybridScore(
  tags: string[],
  spotify: Record<string, number>,
  youtube: Record<string, number>,
  penalties: Record<string, number> = {},
) {
  let score = 0;
  for (const tag of tags) {
    score += 0.6 * (spotify[tag] || 0) + 0.4 * (youtube[tag] || 0);
    if (spotify[tag] && youtube[tag]) score += 40;
    score -= penalties[tag] || 0;
  }
  return Math.max(0, Math.min(100, score));
}
export async function recordListening(
  track: QueueItem,
  seconds: number,
  skipped: boolean,
) {
  const existing = await db.tracks.get(track.id);
  // The queue's copy refreshes what the provider sends, never what the owner changed: a song taken
  // out of Guardadas, a corrected name, the album's cover or when it entered the library.
  await db.tracks.put(mergeSyncedTrack(existing, { ...track, saved: existing?.saved ?? false }));
  const guest = guestModeOn();
  await db.history.add({ trackId: track.id, at: Date.now(), seconds, skipped, ...(guest ? { guest } : {}) });
  // A skip while a guest chooses the music says nothing about the owner's taste.
  if (skipped && seconds < 30 && !guest)
    for (const tag of track.tags) {
      const previous = await db.affinity.get(tag);
      await db.affinity.put({ tag, weight: (previous?.weight || 0) - 35 });
    }
}
export async function buildAffinity() {
  const tracks = await db.tracks.toArray();
  const spotify: Record<string, number> = {};
  const youtube: Record<string, number> = {};
  for (const t of tracks)
    for (const tag of [...t.tags, normalize(t.artist)]) {
      const map = t.source === "spotify" ? spotify : youtube;
      map[tag] =
        (map[tag] || 0) +
        (t.source === "youtube" ? 1.4 : t.tags.includes("top") ? 1.5 : 1.2);
    }
  const penalties = Object.fromEntries(
    (await db.affinity.toArray()).map((a) => [a.tag, -Math.min(0, a.weight)]),
  );
  return { spotify, youtube, penalties };
}
export async function generateMix(
  kind: "daily" | "bridge" | "radar",
  online = true,
): Promise<QueueItem[]> {
  const saved = await db.tracks.toArray();
  const seeds = saved
    .filter((t) => t.source === "spotify")
    .sort(
      (a, b) => Number(b.tags.includes("top")) - Number(a.tags.includes("top")),
    );
  const artists = [...new Set(seeds.map((t) => t.artist))].slice(0, 3);
  if (!saved.length) return [];
  let discoveries: QueueItem[] = [];
  if (isNative && online) {
    for (const artist of artists.length
      ? artists
      : [...new Set(saved.map((t) => t.artist))].slice(0, 2)) {
      try {
        if (kind === "radar") {
          const metadata = await Audio.lookupArtist({ artist });
          for (const related of metadata.related.slice(0, 2))
            discoveries.push(...(await searchAll(related, "all")));
        } else {
          const query =
            kind === "bridge"
              ? `${artist} unreleased demo live session`
              : `${artist} live`;
          discoveries.push(...(await searchAll(query, "youtube")));
        }
      } catch {
        /* Keep the local mix usable while offline. */
      }
    }
  }
  if (kind === "radar")
    discoveries = discoveries.filter(
      (t) => !saved.some((s) => normalize(s.artist) === normalize(t.artist)),
    );
  const affinity = await buildAffinity();
  const pool = [
    ...new Map([...saved, ...discoveries].map((t) => [t.id, t])).values(),
  ].sort(
    (a, b) =>
      hybridScore(
        [...b.tags, normalize(b.artist)],
        affinity.spotify,
        affinity.youtube,
        affinity.penalties,
      ) -
      hybridScore(
        [...a.tags, normalize(a.artist)],
        affinity.spotify,
        affinity.youtube,
        affinity.penalties,
      ),
  );
  if (kind !== "daily")
    return pool
      .filter((t) => kind !== "bridge" || t.source === "youtube")
      .slice(0, 30);
  const sp = pool.filter((t) => t.source === "spotify").slice(0, 15);
  const yt = pool.filter((t) => t.source === "youtube").slice(0, 15);
  const result: QueueItem[] = [];
  while (sp.length || yt.length) {
    if (sp.length) result.push(sp.shift()!);
    if (yt.length) result.push(yt.shift()!);
  }
  return result;
}
let lastMusicBrainz = 0;
export async function validateArtist(
  candidate: string,
): Promise<{ name: string; tags: string[] } | undefined> {
  if (isNative) {
    const result = await Audio.lookupArtist({ artist: candidate });
    return result.validated ? result : undefined;
  }
  // MusicBrainz: identify the client and respect the one-request-per-second limit.
  const wait = Math.max(0, lastMusicBrainz + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastMusicBrainz = Date.now();
  const cached = await db.settings.get("artist:" + normalize(candidate));
  if (cached) return cached.value as { name: string; tags: string[] };
  try {
    const response = await fetch(
      `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent('artist:"' + candidate.replace(/["\\]/g, "") + '"')}&fmt=json&limit=3`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) return;
    const data = await response.json();
    const artist = data.artists?.find(
      (a: any) => similarity(a.name, candidate) > 0.85,
    );
    if (artist) {
      const result = {
        name: artist.name,
        tags: (artist.tags || []).map((t: any) => t.name),
      };
      await db.settings.put({
        key: "artist:" + normalize(candidate),
        value: result,
      });
      return result;
    }
  } catch {
    return;
  }
}
export async function searchAll(
  query: string,
  provider: string,
): Promise<QueueItem[]> {
  if (provider === "playlists") return [];
  const tracks: QueueItem[] = [];
  const results = await Promise.allSettled([
    provider !== "spotify" && isNative
      ? Audio.searchYouTube({ query }).then((r) => r.tracks)
      : Promise.resolve([]),
    provider !== "youtube" && isNative
      ? Auth.spotifyRequest({
          path: "/search?type=track&limit=10&q=" + encodeURIComponent(query),
        }).then((r) => (r.data.tracks?.items || []).map(spotifyTrack))
      : Promise.resolve([]),
  ]);
  for (const result of results)
    if (result.status === "fulfilled") tracks.push(...result.value);
  if (!tracks.length && results.some((r) => r.status === "rejected")) {
    const failure = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    throw new Error(
      failure?.reason?.message ||
        "No se pudo consultar la fuente. Revisa la conexión e intenta nuevamente.",
    );
  }
  if (!isNative)
    return (await db.tracks.toArray()).filter(
      (t) =>
        !t.deleted &&
        normalize(t.title + " " + t.artist).includes(normalize(query)) &&
        (provider === "all" || provider === t.source),
    );
  return tracks.map((t) => {
    if (t.source !== "youtube") return t;
    const p = parseFanUpload(t.title);
    return { ...t, title: p.title, artist: p.artist, tags: p.tags };
  });
}
export async function generateArtistMix(artist: string) {
  const all = await searchAll(artist, "all");
  let rarities: QueueItem[] = [];
  if (isNative) {
    try {
      rarities = await searchAll(
        artist + " unreleased demo live session",
        "youtube",
      );
    } catch {
      /* Keep available sources. */
    }
  }
  const sp = all.filter((t) => t.source === "spotify");
  const yt = [
    ...new Map(
      [...rarities, ...all.filter((t) => t.source === "youtube")].map((t) => [
        t.id,
        t,
      ]),
    ).values(),
  ];
  const mix: QueueItem[] = [];
  while (sp.length || yt.length) {
    if (sp.length) mix.push(sp.shift()!);
    if (yt.length) mix.push(yt.shift()!);
  }
  return mix.slice(0, 30);
}
export function spotifyTrack(t: any): QueueItem {
  return {
    id: "sp:" + t.id,
    source: "spotify",
    spotifyUri: t.uri,
    title: t.name,
    artist: t.artists?.map((a: any) => a.name).join(", ") || "Spotify",
    album: t.album?.name,
    albumId: t.album?.id,
    duration: (t.duration_ms || 0) / 1000,
    artworkUrl: t.album?.images?.[0]?.url,
    popularity: typeof t.popularity === "number" ? t.popularity : undefined,
    tags: [],
  };
}
export interface Lyric {
  time: number;
  text: string;
}
export interface LyricsResult {
  timed: Lyric[];
  plain: string;
  instrumental?: boolean;
  /** Who provided the text, shown as a credit under the lyrics. */
  source?: string;
}

export function geniusLyricsUrl(track: QueueItem): string {
  const { title, artist } = lyricsQuery(track);
  return "https://genius.com/search?" + new URLSearchParams({ q: [title, artist].filter(Boolean).join(" ") });
}

const unknownArtist = /^artista (?:por identificar|no identificad[oa])$/i;
/** Title and main artist as lyric catalogues index them (no "Official Video", features or "- Topic"). */
export function lyricsQuery(track: Pick<QueueItem, "title" | "artist">) {
  const parsed = parseFanUpload(track.title);
  const known = !!track.artist?.trim() && !unknownArtist.test(track.artist.trim());
  const artist = (known ? track.artist : parsed.candidateArtist || "")
    .replace(/\s*-\s*topic$/i, "").replace(/vevo$/i, "")
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\by\b|\bx\b)\s+/i)[0].trim();
  const cleaned = stripTitleNoise(track.title);
  const pieces = cleaned.split(/\s+[-–—]\s+/);
  let title = cleaned;
  if (pieces.length > 1) {
    const head = normalize(pieces[0]);
    const main = normalize(artist);
    if (!known || (main && (head.includes(main) || main.includes(head)))) title = pieces.slice(1).join(" - ");
  }
  title = title
    .replace(/\s*[([](?:feat|ft|with|con|prod)\.?\s[^)\]]*[)\]]/gi, "")
    .replace(/\s+(?:feat|ft)\.?\s.*$/i, "")
    .replace(/\s*[([][^)\]]*(?:remaster|version|versión|edit|en vivo|live)[^)\]]*[)\]]/gi, "")
    .replace(/\s+/g, " ").trim();
  return { title: title || cleaned, artist };
}

type LrclibEntry = {
  trackName?: string; artistName?: string; duration?: number;
  syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean;
};

/** Picks the catalogue entry that matches title, artist and length, preferring synced lyrics. */
export function pickLrclib(entries: LrclibEntry[], title: string, artist: string, duration: number) {
  const wantedTitle = normalize(title);
  const wantedArtist = normalize(artist);
  let best: LrclibEntry | undefined;
  let bestScore = 0;
  for (const entry of entries) {
    const name = normalize(entry.trackName || "");
    const by = normalize(entry.artistName || "");
    if (!name) continue;
    let score = name === wantedTitle ? 4 : name.includes(wantedTitle) || wantedTitle.includes(name) ? 2 : -10;
    if (wantedArtist) score += by === wantedArtist ? 3 : by.includes(wantedArtist) || wantedArtist.includes(by) ? 2 : -2;
    if (duration > 0 && entry.duration) {
      const gap = Math.abs(entry.duration - duration);
      score += gap <= 3 ? 2 : gap <= 12 ? 0.5 : -2;
    }
    if (entry.syncedLyrics) score += 1.5;
    else if (entry.plainLyrics) score += 0.5;
    else if (!entry.instrumental) continue;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore >= 5 ? best : undefined;
}

export function parseSyncedLyrics(raw: string): Lyric[] {
  return raw.split("\n").flatMap(line => {
    const markers = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = line.slice((markers.at(-1)?.index ?? 0) + (markers.at(-1)?.[0].length ?? 0)).trim();
    return markers.map(marker => ({ time: Number(marker[1]) * 60 + Number(marker[2]), text }));
  }).sort((a, b) => a.time - b.time);
}

async function lrclib(path: string, params: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(`https://lrclib.net/api/${path}?` + new URLSearchParams(params), { signal });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error("LRCLIB respondió " + response.status);
  return response.json();
}

/**
 * Lyrics from LRCLIB (synced when available) with fuzzy matching, then the lyrics YouTube Music
 * shows for the same song (licensed text, usually LyricFind). Genius has no public lyrics API.
 */
export async function getLyrics(track: QueueItem, signal?: AbortSignal): Promise<LyricsResult> {
  const { title, artist } = lyricsQuery(track);
  const duration = Number.isFinite(track.duration) && track.duration > 0 ? Math.round(track.duration) : 0;
  const key = "lyrics:v3:" + JSON.stringify([track.id, title, artist, duration]);
  const cached = await db.settings.get(key);
  if (cached) return cached.value as LyricsResult;
  let reached = false;
  let entry: LrclibEntry | undefined;
  try {
    if (artist && duration) {
      entry = await lrclib("get", { track_name: title, artist_name: artist, duration: String(duration) }, signal);
      reached = true;
    }
    if (!entry?.syncedLyrics && !entry?.plainLyrics && !entry?.instrumental) {
      const found = await lrclib("search", artist ? { track_name: title, artist_name: artist } : { q: title }, signal);
      reached = true;
      entry = pickLrclib(Array.isArray(found) ? found : [], title, artist, duration) ?? undefined;
      if (!entry && artist) {
        const loose = await lrclib("search", { q: `${title} ${artist}` }, signal);
        entry = pickLrclib(Array.isArray(loose) ? loose : [], title, artist, duration);
      }
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  let result: LyricsResult | undefined;
  if (entry && (entry.syncedLyrics || entry.plainLyrics || entry.instrumental)) {
    result = {
      timed: parseSyncedLyrics(String(entry.syncedLyrics || "")),
      plain: typeof entry.plainLyrics === "string" ? entry.plainLyrics.trim() : "",
      instrumental: entry.instrumental === true,
      source: "LRCLIB",
    };
  }
  if (!result && isNative && !signal?.aborted) {
    try {
      const found = await Auth.youtubeLyrics(track.videoId
        ? { videoId: track.videoId }
        : { query: [title, artist].filter(Boolean).join(" ") });
      reached = true;
      if (found.found && found.text?.trim())
        result = { timed: [], plain: found.text.trim(), source: found.source ? `YouTube Music · ${found.source}` : "YouTube Music" };
    } catch {
      /* The catalogue lookup above already decided whether the network was reachable. */
    }
  }
  if (!result) {
    if (!reached) throw new Error("No se pudo conectar con los servicios de letras.");
    return { timed: [], plain: "" };
  }
  if (!signal?.aborted) await db.settings.put({ key, value: result }).catch(() => {});
  return result;
}
