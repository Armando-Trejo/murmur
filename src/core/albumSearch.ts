import { Auth, isNative } from "../native";
import { spotifyTrack } from "./DiscoveryEngine";
import type { QueueItem } from "./types";

export interface AlbumResult {
  /** Route id for the collection view: MPREb… (YouTube Music) or spalbum-<id> (Spotify). */
  feedId: string;
  /** Id the saved playlist gets in the library, to show it as already saved. */
  libraryId: string;
  source: "youtube" | "spotify";
  title: string;
  artist: string;
  year?: string;
  artworkUrl?: string;
  link: string;
}

export const SPOTIFY_ALBUM_PREFIX = "spalbum-";

/** Collection link for an album route id (see AlbumResult.feedId). */
export function albumLink(feedId: string) {
  return feedId.startsWith(SPOTIFY_ALBUM_PREFIX)
    ? "https://open.spotify.com/album/" + feedId.slice(SPOTIFY_ALBUM_PREFIX.length)
    : "https://music.youtube.com/browse/" + feedId;
}

type SpotifyAlbum = {
  id?: string; name?: string; release_date?: string; album_type?: string;
  artists?: { name?: string }[]; images?: { url?: string }[];
};

export function fromSpotify(items: SpotifyAlbum[]): AlbumResult[] {
  return items.flatMap((album) => {
    if (!album?.id || !/^[A-Za-z0-9]{22}$/.test(album.id) || !album.name) return [];
    return [{
      feedId: SPOTIFY_ALBUM_PREFIX + album.id,
      libraryId: "sp:album:" + album.id,
      source: "spotify" as const,
      title: album.name,
      artist: (album.artists ?? []).map((a) => a.name).filter(Boolean).join(", "),
      year: album.release_date?.slice(0, 4),
      artworkUrl: album.images?.[0]?.url,
      link: "https://open.spotify.com/album/" + album.id,
    }];
  });
}

type YouTubeAlbum = { id?: string; title?: string; artist?: string; year?: string; artworkUrl?: string };

export function fromYouTube(items: YouTubeAlbum[]): AlbumResult[] {
  return items.flatMap((album) => {
    if (!album?.id || !/^MPREb[A-Za-z0-9_-]{2,120}$/.test(album.id) || !album.title) return [];
    return [{
      feedId: album.id,
      libraryId: "ytpl:" + album.id,
      source: "youtube" as const,
      title: album.title,
      artist: album.artist ?? "",
      year: album.year || undefined,
      artworkUrl: album.artworkUrl,
      link: "https://music.youtube.com/browse/" + album.id,
    }];
  });
}

/** Alternates both providers so the first row shows each one's best match. */
export function interleave(a: AlbumResult[], b: AlbumResult[]) {
  const out: AlbumResult[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

/**
 * Whole albums from YouTube Music and Spotify. Each provider fails on its own (Spotify may not be
 * connected); the result says which ones answered.
 */
export async function searchAlbums(query: string) {
  if (!isNative) return { albums: [] as AlbumResult[], failed: [] as string[] };
  const q = query.trim().slice(0, 200);
  const [youtube, spotify] = await Promise.allSettled([
    Auth.youtubeAlbums({ query: q }).then((r) => fromYouTube(r.albums ?? [])),
    // Spotify answers 400 above limit=10 for apps in development mode.
    Auth.spotifyRequest({ path: "/search?type=album&limit=10&q=" + encodeURIComponent(q) })
      .then((r) => fromSpotify(r.data?.albums?.items ?? [])),
  ]);
  const failed = [youtube.status === "rejected" ? "YouTube Music" : "", spotify.status === "rejected" ? "Spotify" : ""].filter(Boolean);
  return {
    albums: interleave(youtube.status === "fulfilled" ? youtube.value : [], spotify.status === "fulfilled" ? spotify.value : []),
    failed,
  };
}

/** The songs of an album result, in album order, without saving it to the library. */
export async function albumTracks(album: Pick<AlbumResult, "feedId" | "source">): Promise<QueueItem[]> {
  if (album.source === "youtube") return (await Auth.youtubeCollection({ id: album.feedId })).tracks ?? [];
  const id = album.feedId.slice(SPOTIFY_ALBUM_PREFIX.length);
  const { data } = await Auth.spotifyRequest({ path: "/albums/" + id });
  return (data?.tracks?.items ?? []).filter((t: { id?: string }) => t?.id).map((t: object) => spotifyTrack({ ...t, album: data }));
}
