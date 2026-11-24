import "fake-indexeddb/auto";
import { importBackup } from "../src/core/db";
import { openAuraPreview } from "./aura-preview";
import type { QueueItem } from "../src/core/types";

declare global {
  interface Window {
    previewTracks: QueueItem[];
    previewReady: Promise<void>;
    CapacitorPlatforms: unknown;
  }
}
const tracks = window.previewTracks;
const queueSeed = tracks.map(track => ({ ...track, queueId: "preview-" + track.id }));
let current = queueSeed[0];
let queue = queueSeed.slice(1);
let previous: QueueItem[] = [];
let playing = false;
let positionMs = 23_000;
const events = new Map<string, Set<(value: unknown) => void>>();
function emit(name: string, value: unknown) {
  events.get(name)?.forEach(listener => listener(value));
}
function snapshot() {
  return { track: current, queue: [...previous, current, ...queue], positionMs, playing, loading: false, transport: "youtube" };
}
function playbackState() {
  return { trackId: current.id, queueId: current.queueId, playing, loading: false, positionMs };
}
function select(track: typeof current) {
  current = track;
  positionMs = 0;
  playing = true;
  return { duration: track.duration, description: "", playing, loading: false };
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) emit("onPlaybackProgress", playbackState());
});
setInterval(() => {
  if (!playing || document.hidden) return;
  positionMs = Math.min(positionMs + 500, current.duration * 1000);
  emit("onPlaybackProgress", playbackState());
}, 500);

const methods: Record<string, (...args: any[]) => unknown> = {
  status: () => ({ preview: true, spotify: false, youtube: true, youtubeSession: true, oauth: false }),
  getState: snapshot,
  openVisualizer: () => {
    const move = (direction: 1 | -1) => {
      const list = [...previous, current, ...queue];
      const index = previous.length + direction;
      const target = list[index];
      if (!target) return;
      previous = list.slice(0, index);
      queue = list.slice(index + 1);
      select(target);
      emit("onNativeTrackChanged", { id: target.id, queueId: target.queueId, playing, loading: false, transport: "youtube" });
    };
    openAuraPreview({
      read: snapshot,
      toggle: () => { playing = !playing; emit("onPlaybackStateChanged", playbackState()); },
      next: () => move(1),
      previous: () => move(-1),
      seek: seconds => { positionMs = seconds * 1000; emit("onPlaybackProgress", playbackState()); },
    });
  },
  pause: () => { playing = false; emit("onPlaybackStateChanged", playbackState()); },
  resume: () => { playing = true; emit("onPlaybackStateChanged", playbackState()); },
  extractAndPlay: select,
  seekTo: ({ positionMs: value }) => { positionMs = value; emit("onPlaybackProgress", playbackState()); },
  setQueue: ({ tracks, previous: prior, currentQueueId }) => {
    if (currentQueueId === current.queueId) {
      queue = tracks;
      previous = prior ?? previous;
    }
  },
  setAutoMixMode: () => undefined,
  getLaunchUrl: () => undefined,
  youtubeHome: () => ({
    shelves: [{
      title: "Selección de ejemplo",
      items: [
        { id: "PLmurmurDemo", title: "Colección de ejemplo", artworkUrl: tracks[2]?.artworkUrl,
          link: "https://music.youtube.com/playlist?list=PLmurmurDemo", subtitle: "Playlist" },
        ...tracks.map(track => ({ id: track.id, title: track.title, subtitle: track.artist, track })),
      ],
    }],
  }),
  youtubeCollection: () => ({ title: "Colección de ejemplo", artworkUrl: tracks[2]?.artworkUrl, tracks }),
  searchYouTube: ({ query }) => ({
    tracks: tracks.filter(track => (track.title + " " + track.artist).toLowerCase().includes(String(query).toLowerCase())),
  }),
  spotifyRequest: () => ({ data: { items: [], tracks: { items: [] } } }),
  addListener: (name, listener) => {
    const listeners = events.get(name) ?? new Set();
    listeners.add(listener);
    events.set(name, listeners);
    return { remove: async () => listeners.delete(listener) };
  },
};
window.CapacitorPlatforms = {
  currentPlatform: {
    getPlatform: () => "android",
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
    registerPlugin: () => new Proxy({}, {
      get: (_, method) => method === "then" ? undefined : async (...args: unknown[]) => {
        if (typeof method === "string" && methods[method]) return methods[method](...args);
        throw Error("Esta acción requiere la aplicación de Android.");
      },
    }),
  },
};

// Keep the portable preview independent of the device's storage and network.
window.fetch = async () => new Response("{}", { status: 404 });
window.previewReady = importBackup(JSON.stringify({
  format: "hybrid-sound", version: 1,
  tables: {
    tracks,
    playlists: [{ id: "local:preview", title: "Selección de ejemplo", source: "hybrid", trackIds: tracks.map(t => t.id) }],
    playlist_overrides: [],
    history: [{ trackId: tracks[0].id, at: 1, seconds: 45, skipped: false }],
    affinity: [],
    settings: [],
  },
}));
