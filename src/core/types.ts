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
/** A cover as stored on a song. */
export interface ArtSnapshot extends CustomArtwork {
  artworkUrl?: string;
}
export interface QueueItem extends CustomArtwork {
  /** The album whose cover this song shows (an album's cover is the cover of its songs). */
  coverAlbum?: string;
  /** The song's cover before the album's, restored when it leaves the album. */
  ownArt?: ArtSnapshot;
  /** Names the owner corrected: a sync keeps them. */
  edits?: { title: string; artist: string; album?: string };
  /** Taken out of «Guardadas» by the owner: a sync does not like it again. */
  unliked?: boolean;
  /** Deleted by the owner: hidden everywhere, kept for the listening history. */
  deleted?: boolean;
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
  /** When the song entered the library (ms). Stamped from 2.17 on; older songs have none. */
  addedAt?: number;
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
  /** The mood this song was picked for, as the presenter says it ("algo triste"). */
  mood?: string;
  /** Key of that mood (moods.ts). */
  moodKey?: string;
  /** The listener asked for the mood ("pon algo triste"): the endless queue keeps it instead of rotating. */
  moodAsked?: boolean;
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
  /** When it entered the library (ms). */
  addedAt?: number;
  /** Songs the owner removed: a sync does not bring them back. */
  removedIds?: string[];
  /** What the owner changed by hand: a sync keeps it. */
  edited?: { title?: boolean; artist?: boolean; year?: boolean; kind?: boolean };
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
