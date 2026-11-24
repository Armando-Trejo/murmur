import { Audio, Auth, isNative } from "../native";
import { normalize } from "./FanUploadParser";
import { creditedArtists } from "../components/ArtistProfile";
import { unwrapSpotifyTrack } from "./SpotifyLibrary";
import { songKey } from "./blendMixes";
import type { QueueItem } from "./types";

/**
 * Songs for "Aleatorio mágico": close to what is playing but outside the album or playlist.
 * Sources, in order of trust: YouTube Music's radio after the current song, then Spotify's
 * catalogue for artists related to the ones in the queue (Deezer's graph through the native lookup).
 */
async function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  try { return await promise; } catch { return undefined; }
}

const lead = (artist: string) => creditedArtists(artist)[0] ?? artist;

export async function magicPicks(queue: QueueItem[], current: QueueItem | undefined, count: number): Promise<QueueItem[]> {
  if (!isNative || count <= 0) return [];
  const inQueue = new Set(queue.map(songKey));
  const artists = [...new Map(queue.map((t) => [normalize(lead(t.artist)), lead(t.artist)])).values()];
  const queueArtists = new Set(artists.map(normalize));
  const picks: QueueItem[] = [];
  const add = (tracks: QueueItem[], max: number) => {
    for (const track of tracks) {
      if (picks.length >= count || max <= 0) break;
      const key = songKey(track);
      if (inQueue.has(key) || picks.some((p) => songKey(p) === key)) continue;
      picks.push({ ...track, smart: true });
      max--;
    }
  };

  // The radio YouTube builds after the current song: its own idea of "more like this".
  if (current?.videoId) {
    const radio = (await settle(Auth.youtubeCollection({ id: "RDAMVM" + current.videoId })))?.tracks ?? [];
    // Prefer other artists so the magic actually brings something new.
    add(radio.filter((t) => !queueArtists.has(normalize(lead(t.artist)))), Math.ceil(count / 2));
    add(radio, Math.ceil(count / 2));
  }

  // Related artists of the queue's main artists, through Spotify's catalogue.
  const related: string[] = [];
  for (const name of artists.slice(0, 3)) {
    const info = await settle(Audio.lookupArtist({ artist: name }));
    for (const other of info?.related ?? []) if (!queueArtists.has(normalize(other)) && !related.includes(other)) related.push(other);
  }
  for (const name of related.slice(0, 6)) {
    if (picks.length >= count) break;
    const found = await settle(Auth.spotifyRequest({ path: "/search?type=track&limit=3&q=" + encodeURIComponent(`artist:"${name}"`) }));
    const tracks = (found?.data?.tracks?.items ?? []).map(unwrapSpotifyTrack).filter((t: QueueItem | undefined): t is QueueItem => !!t);
    add(tracks, 2);
  }
  return picks;
}

/** Intercalates picks after every `every` songs, starting after the first one so the flow stays familiar. */
export function interleaveMagic(upcoming: QueueItem[], picks: QueueItem[], every = 3) {
  const out: QueueItem[] = [];
  let next = 0;
  upcoming.forEach((track, index) => {
    out.push(track);
    if ((index + 1) % every === 0 && next < picks.length) out.push(picks[next++]);
  });
  while (next < picks.length && out.length < upcoming.length + picks.length) out.push(picks[next++]);
  return out;
}
