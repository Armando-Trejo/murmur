import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import type { QueueItem } from "./core/types";
export const isNative = Capacitor.isNativePlatform();
export interface FeedItem {
  id: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  track?: QueueItem;
  link?: string;
  artistId?: string;
}
export interface FeedShelf { title: string; items: FeedItem[] }
export interface ArtistPage {
  id: string;
  name: string;
  artworkUrl?: string;
  description?: string;
  audience?: string;
  shelves: FeedShelf[];
}
interface AudioBridge {
  openProviderHome(o: { provider: "youtube" | "spotify" }): Promise<void>;
  openVisualizer(): Promise<void>;
  openGeniusLyrics(o: { url: string }): Promise<void>;
  openYouTubeArtist(o: { id: string }): Promise<void>;
  openProviderSearch(o: { provider: string; query: string }): Promise<void>;
  getTrackInfo(o: { videoId: string }): Promise<{ track: QueueItem }>;
  lookupArtist(o: { artist: string }): Promise<{
    name: string;
    validated?: boolean;
    tags: string[];
    related: string[];
  }>;
  setQueue(o: {
    tracks: QueueItem[];
    previous?: QueueItem[];
    currentQueueId?: string;
  }): Promise<void>;
  searchYouTube(o: { query: string }): Promise<{ tracks: QueueItem[] }>;
  extractAndPlay(o: QueueItem & { refreshSource?: boolean; positionMs?: number; startAtMs?: number }): Promise<{
    duration: number;
    description: string;
    playing?: boolean;
    loading?: boolean;
  }>;
  preloadNextStream(o: QueueItem): Promise<void>;
  /** Resolves (never downloads) the audio links of likely next taps into the native cache. */
  prefetchAudio(o: { videoIds: string[] }): Promise<void>;
  /** Music screen over the lock screen when the display turns off during playback. */
  setLockVisualizer(o: { enabled: boolean }): Promise<void>;
  getLockVisualizer(): Promise<{ enabled: boolean }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seekTo(o: { positionMs: number }): Promise<void>;
  triggerManualMix(): Promise<void>;
  setAutoMixMode(o: { mode: string }): Promise<void>;
  networkState(): Promise<{ online: boolean; metered: boolean; charging: boolean }>;
  deleteOfflineAudio(o: { path: string }): Promise<{ deleted: boolean }>;
  downloadOfflineAudio(o: {
    videoId: string;
    fileName: string;
  }): Promise<{ path: string }>;
  /** minutes > 0 stops after that time, -2 at the end of the current track, 0 cancels. */
  setSleepTimer(o: { minutes: number }): Promise<void>;
  haptic(o: { kind: "tick" | "confirm" | "reject" }): Promise<void>;
  getState(): Promise<{
    playing: boolean;
    positionMs: number;
    durationMs: number;
    track?: QueueItem;
    queue?: QueueItem[];
    loading?: boolean;
    transport?: string;
  }>;
  setDucking(o: { ducking: boolean }): Promise<void>;
  showVideo(o: { videoId: string }): Promise<void>;
  saveBackup(o: { content: string }): Promise<{ saved: boolean }>;
  saveAutoBackup(o: { content: string }): Promise<{ saved: boolean; file: string }>;
  speak(o: { text: string; force?: boolean }): Promise<void>;
  ttsVoices(): Promise<{ voices: { name: string; label: string; network: boolean; selected: boolean }[] }>;
  setTtsVoice(o: { name?: string; preview?: boolean; sample?: string }): Promise<void>;
  openUpdate(o: { url: string }): Promise<void>;
  voicePrefs(o?: { replies?: boolean; presenter?: boolean }): Promise<{ replies: boolean; presenter: boolean }>;
  addListener(
    name: string,
    callback: (event: any) => void,
  ): Promise<PluginListenerHandle>;
}
export interface ConnectionStatus {
  spotify: boolean;
  youtube: boolean;
  oauth: boolean;
  spotifySession?: boolean;
  spotifyRevision?: number;
  youtubeRevision?: number;
  preview?: boolean;
  youtubeSession?: boolean;
  spotifyMessage?: string;
  spotifyCode?: string;
  spotifyState?: string;
  clientId?: string;
  spotifyEngineAuthorized?: boolean;
  spotifyEngineAuthorizing?: boolean;
  spotifyPlaybackMode?: "integrated" | "web" | "connect";
  spotifyWebAuthorized?: boolean;
}
interface AuthBridge {
  login(o: { provider: string }): Promise<{ connected: boolean }>;
  status(): Promise<ConnectionStatus>;
  verifySpotify(): Promise<ConnectionStatus>;
  playSpotify(o: { uri: string } & Partial<QueueItem>): Promise<{
    deviceName?: string;
    deviceType?: string;
    transport?: string;
    playing?: boolean;
    loading?: boolean;
  }>;
  authorizeSpotifyEngine(): Promise<{ started: boolean }>;
  completeSpotifyEngineAuthorization(o: {
    url: string;
  }): Promise<ConnectionStatus>;
  setSpotifyPlaybackMode(o: {
    mode: "integrated" | "web" | "connect";
  }): Promise<ConnectionStatus>;
  openSpotify(): Promise<void>;
  spotifyAndroidSetup(): Promise<{
    packageName: string;
    sha1: string;
    redirectUri: string;
  }>;
  logout(o: { provider: string }): Promise<void>;
  spotifyRequest(o: {
    path: string;
    method?: string;
    body?: string;
  }): Promise<{ data: any }>;
  youtubeCollection(o: { id: string; personalized?: boolean }): Promise<{
    title: string; artworkUrl?: string; artist?: string; year?: string; subtitle?: string; tracks: QueueItem[];
  }>;
  /** YouTube Music artist page; resolves the channel by name when no id is known. */
  youtubeArtist(o: { id?: string; name?: string }): Promise<ArtistPage>;
  /** Songs tab of YouTube Music search. */
  youtubeSongs(o: { query: string }): Promise<{ songs: { videoId: string; title: string; artist: string; album?: string; duration: number; artworkUrl?: string }[] }>;
  /** Albums tab of YouTube Music search. */
  youtubeAlbums(o: { query: string }): Promise<{ albums: { id: string; title: string; artist?: string; year?: string; artworkUrl?: string }[] }>;
  /** Playlists tab of YouTube Music search (YouTube's own first, then community). */
  youtubePlaylists(o: { query: string }): Promise<{ playlists: { id: string; title: string; artist?: string; artworkUrl?: string }[] }>;
  /** Plain lyrics as YouTube Music shows them, by video or by a "title artist" query. */
  youtubeLyrics(o: { videoId?: string; query?: string }): Promise<{ found: boolean; text?: string; source?: string }>;
  youtubeHome(): Promise<{ shelves: FeedShelf[] }>;
  youtubeLibrary(): Promise<{ playlists: any[] }>;
  youtubePlaylist(o: { id: string }): Promise<{ tracks: QueueItem[] }>;
  oauthLogin(o: { clientId: string }): Promise<void>;
}
interface VoiceBridge {
  listen(): Promise<{ text: string }>;
  status(): Promise<{
    available: boolean;
    onDevice: boolean;
    model: boolean;
    microphone: string;
  }>;
  openSettings(): Promise<void>;
  downloadModel(): Promise<{ available: boolean; message: string }>;
  /** "Ok MURMUR" wake phrase (offline listener in a microphone foreground service). */
  wakeWordStatus(): Promise<{ enabled: boolean; running: boolean; model: boolean; mode?: "music" | "screen" }>;
  setWakeMode(o: { mode: "music" | "screen" }): Promise<{ mode: "music" | "screen" }>;
  /** Report of the last unexpected close, once (null when there was none). */
  lastCrash(): Promise<{ report: string | null; version: string }>;
  /** Android's share sheet with a text. */
  shareText(o: { text: string; title?: string }): Promise<void>;
  /** Names the speech recognizer should expect (artists, playlists). */
  setVoiceHints(o: { hints: string[] }): Promise<void>;
  setWakeWord(o: { enabled: boolean }): Promise<{ enabled: boolean; model?: boolean }>;
  /** "Solo mi voz": speaker check for "Ok MURMUR"; the enrolled voice stays on the phone. */
  voiceMatchStatus(): Promise<{ enabled: boolean; enrolled: boolean; model: boolean }>;
  /** Downloads (first time, ~13 MB) and loads what "Entrena tu voz" needs. */
  prepareVoiceMatch(): Promise<{ model: boolean }>;
  /** One take (1-3) of "Ok MURMUR"; ok:false with a message when it was not usable. Events: "onVoiceEnrollment". */
  enrollVoiceTake(o: { take: number }): Promise<{ ok: boolean; take: number; done: boolean; restart?: boolean; message?: string }>;
  setVoiceMatch(o: { enabled: boolean }): Promise<{ enabled: boolean }>;
  clearVoiceProfile(): Promise<{ enabled: boolean; enrolled: boolean }>;
  rankTags(o: {
    query: string;
    tags: string[];
  }): Promise<{ ranked: { text: string; score: number }[] }>;
}
export const Audio = registerPlugin<AudioBridge>("YouTubeAudio");
export const Auth = registerPlugin<AuthBridge>("AuthBridge");
export const Voice = registerPlugin<VoiceBridge>("LocalIntent");
