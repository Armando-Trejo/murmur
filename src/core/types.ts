export type Source = "spotify" | "youtube";
export type MixMode = "off" | "smooth" | "dj";
export interface Chapter {
  title: string;
  positionMs: number;
}
export interface QueueItem {
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
}
export interface Playlist {
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
