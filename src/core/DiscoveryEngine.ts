import { Audio, Auth, isNative } from "../native";
import { db } from "./db";
import { parseFanUpload, normalize } from "./FanUploadParser";
import { similarity } from "./SourceResolver";
import type { QueueItem } from "./types";
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
  await db.tracks.put({ ...track, saved: existing?.saved ?? false });
  await db.history.add({ trackId: track.id, at: Date.now(), seconds, skipped });
  if (skipped && seconds < 30)
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
}

export function geniusLyricsUrl(track: QueueItem): string {
  const parsed = parseFanUpload(track.title);
  const artist = track.artist === "Artista por identificar" ? parsed.candidateArtist : track.artist;
  const query = [parsed.title, artist]
    .filter(Boolean).join(" ");
  return "https://genius.com/search?" + new URLSearchParams({ q: query });
}

export async function getLyrics(track: QueueItem, signal?: AbortSignal): Promise<LyricsResult> {
  const { title, candidateArtist } = parseFanUpload(track.title);
  const artist = track.artist === "Artista por identificar" ? candidateArtist : track.artist;
  if (!artist?.trim()) return { timed: [], plain: "" };
  const key = "lyrics:v2:" + JSON.stringify([track.id, title, artist, Math.round(track.duration)]);
  const cached = await db.settings.get(key);
  if (cached) return cached.value as LyricsResult;
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (Number.isFinite(track.duration) && track.duration > 0) params.set("duration", String(Math.round(track.duration)));
  const response = await fetch("https://lrclib.net/api/get?" + params, { signal });
  if (response.status === 404) return { timed: [], plain: "" };
  if (!response.ok) throw new Error("No se pudo conectar con LRCLIB.");
  const data = await response.json();
  const timed = String(data.syncedLyrics || "").split("\n").flatMap(line => {
    const markers = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    return markers.map(marker => ({
      time: Number(marker[1]) * 60 + Number(marker[2]),
      text: line.slice((markers.at(-1)?.index ?? 0) + (markers.at(-1)?.[0].length ?? 0)).trim(),
    }));
  }).sort((a, b) => a.time - b.time);
  const result = { timed, plain: typeof data.plainLyrics === "string" ? data.plainLyrics.trim() : "", instrumental: data.instrumental === true };
  if (!signal?.aborted && (timed.length || result.plain || result.instrumental)) {
    await db.settings.put({ key, value: result }).catch(() => {});
  }
  return result;
}
