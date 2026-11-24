export type Source = "spotify" | "youtube";
export type MixMode = "off" | "smooth" | "dj";
export interface Chapter {
  title: string;
  positionMs: number;
}
/** How a cover is framed: focal point (0–100 %), zoom (1–3) and whether it fills or fits the square. */
export interface ArtworkFrame {
  x: number;
  y: number;
  zoom: number;
  fit: "cover" | "contain";
}
export interface CustomArtwork {
  /** An image the user picked, resized and kept on the phone (data:image/jpeg). */
  customArtwork?: string;
  artworkFrame?: ArtworkFrame;
}
export interface QueueItem extends CustomArtwork {
  id: string;
  source: Source;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  duration: number;
  artworkUrl?: string;
  videoId?: string;
  spotifyUri?: string;
  tags: string[];
  chapters?: Chapter[];
  offlinePath?: string;
  description?: string;
  saved?: boolean;
  bpm?: number;
  popularity?: number;
  viewCount?: number;
  queueId?: string;
  /** Added by the user with "Añadir a la cola"; plays before the rest of the context, in order. */
  userQueued?: boolean;
  /** A Spotify track playing its YouTube Music twin through MURMUR's own engine. */
  bridgedFrom?: "spotify";
  /** Added by "Aleatorio mágico": related to the context, removed when shuffle is turned off. */
  smart?: boolean;
  /** Added because the queue was about to end, so music never stops; stays when shuffle is turned off. */
  continuation?: boolean;
}
export interface Playlist extends CustomArtwork {
  kind?: "playlist" | "album";
  id: string;
  title: string;
  source: Source | "hybrid";
  trackIds: string[];
  artworkUrl?: string;
  artist?: string;
  year?: string;
  subtitle?: string;
}
export interface Override {
  id?: number;
  spotify_playlist_id: string;
  videoId: string;
  trackId: string;
  position: number;
}
export interface HistoryEntry {
  id?: number;
  trackId: string;
  at: number;
  seconds: number;
  skipped: boolean;
}
