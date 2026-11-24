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
  setSleepTimer: () => undefined,
  haptic: () => undefined,
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
const demoVerses = [
  "Letra de demostración para MURMUR",
  "Las líneas siguen la canción",
  "y la actual queda en el centro",
  "Toca una línea para saltar a ella",
  "Desliza para leer con calma",
  "y vuelve con Seguir la letra",
  "El color llega desde la portada",
  "y se funde con el negro del fondo",
];
window.fetch = async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://lrclib.net/api/get")) {
    const duration = Number(new URL(url).searchParams.get("duration")) || 240;
    const lines: string[] = [];
    for (let time = 2, index = 0; time < duration; time += 4.5, index++) {
      const stamp = `${String(Math.floor(time / 60)).padStart(2, "0")}:${(time % 60).toFixed(2).padStart(5, "0")}`;
      lines.push(`[${stamp}] ${demoVerses[index % demoVerses.length]}`);
    }
    return new Response(JSON.stringify({ syncedLyrics: lines.join(String.fromCharCode(10)), plainLyrics: "", instrumental: false }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("{}", { status: 404 });
};
// Synthetic listening history for the summary screen, spread across the last week.
const now = Date.now();
const demoHistory = Array.from({ length: 34 }, (_, index) => {
  const track = tracks[(index * 5 + Math.floor(index / 3)) % tracks.length];
  const day = index % 7;
  const at = now - day * 86_400_000 - ((index * 37) % 9) * 3_600_000 - 60_000;
  return { trackId: track.id, at, seconds: index % 6 === 5 ? 12 : Math.min(track.duration, 70 + ((index * 53) % 200)), skipped: index % 6 === 5 };
});
window.previewReady = importBackup(JSON.stringify({
  format: "hybrid-sound", version: 1,
  tables: {
    tracks,
    playlists: [{ id: "local:preview", title: "Selección de ejemplo", source: "hybrid", trackIds: tracks.map(t => t.id) }],
    playlist_overrides: [],
    history: demoHistory,
    affinity: [],
    settings: [],
  },
}));
