import { Audio, Auth, isNative, Jam, type JamRequest } from "../native";
import type { PluginListenerHandle } from "@capacitor/core";
import { player } from "./AudioOrchestrator";
import type { QueueItem } from "./types";
import { parseFanUpload } from "./FanUploadParser";

/**
 * JAM: people nearby scan a QR and, from their browser (no MURMUR needed), search, add and order
 * songs in this phone's queue. Their songs carry `jamGuest`, so they never teach the owner's taste
 * unless the owner saves or likes them (DiscoveryEngine.recordListening, tasteGuard).
 */
/** `dj`: the owner let this guest pause, skip and put songs first. */
export interface JamGuest { id: string; name: string; added: number; lastSeen: number; dj?: boolean }
export interface JamSession { url: string; startedAt: number; guests: JamGuest[] }

const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const MAX_ADDS = 25; // per guest, every 10 minutes
const clean = (text: unknown, max = 200) => (typeof text === "string" ? text.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");

let session: JamSession | undefined;
let listener: PluginListenerHandle | undefined;
let unsubscribe: (() => void) | undefined;
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let lastPublished = "";
const adds = new Map<string, number[]>();
const watchers = new Set<() => void>();

export const jamSession = () => session;
export function onJamChange(fn: () => void) { watchers.add(fn); return () => { watchers.delete(fn); }; }
const changed = () => watchers.forEach((fn) => fn());

/** Who is asking: the id and name the guest's browser keeps ("id|name"). */
function guestOf(request: JamRequest): { id: string; name: string } {
  const [id = "", name = ""] = request.guest.split("|");
  const safeId = /^[a-z0-9]{6,24}$/i.test(id) ? id : "ip" + request.ip.replace(/\D/g, "").slice(-6);
  return { id: safeId, name: clean(decodeURIComponent(name || ""), 24) || "Invitado" };
}

function seen(guest: { id: string; name: string }) {
  if (!session) return;
  const known = session.guests.find((g) => g.id === guest.id);
  // A new object each time, so the owner's panel redraws (useSyncExternalStore compares references).
  const isNew = !known;
  session = {
    ...session,
    guests: known
      ? session.guests.map((g) => (g.id === guest.id ? { ...g, name: guest.name, lastSeen: Date.now() } : g))
      : [...session.guests, { ...guest, added: 0, lastSeen: Date.now() }],
  };
  if (isNew || known?.name !== guest.name) changed();
}

/** A queue entry as the guest page shows it (no local paths, nothing private). */
const shown = (t: QueueItem) => ({
  queueId: t.queueId, title: t.title, artist: t.artist, duration: Math.round(t.duration || 0),
  artworkUrl: t.artworkUrl, guest: t.jamGuest?.name, guestId: t.jamGuest?.id,
});

function snapshot() {
  const state = player.getSnapshot();
  const current = state.queue[state.index];
  return JSON.stringify({
    active: true,
    playing: state.playing,
    position: Math.round(state.position),
    duration: Math.round(state.duration || current?.duration || 0),
    current: current ? shown(current) : null,
    upcoming: state.queue.slice(state.index + 1, state.index + 51).map(shown),
    guests: session?.guests.length ?? 0,
    djs: session?.guests.filter((g) => g.dj).map((g) => g.id) ?? [],
    at: Date.now(),
  });
}

function publish(now = false) {
  clearTimeout(publishTimer);
  const send = () => {
    if (!session) return;
    const state = snapshot();
    if (state.replace(/"at":\d+/, "") === lastPublished) return;
    lastPublished = state.replace(/"at":\d+/, "");
    void Jam.publish({ state }).catch(() => {});
  };
  if (now) send();
  else publishTimer = setTimeout(send, 350);
}

async function search(query: string) {
  const q = clean(query, 120);
  if (q.length < 2) return [];
  // Like voice search: YouTube first (it understands vague requests, "intro 2 de naruto"), then
  // YouTube Music's songs (clean audio and names), one entry per video.
  const [videos, songs] = await Promise.all([
    Audio.searchYouTube({ query: q }).then((r) => r.tracks).catch(() => [] as QueueItem[]),
    Auth.youtubeSongs({ query: q }).then((r) => r.songs).catch(() => []),
  ]);
  const out: { videoId: string; title: string; artist: string; album?: string; duration: number; artworkUrl?: string }[] = [];
  const seen = new Set<string>();
  const push = (item: (typeof out)[number]) => { if (VIDEO.test(item.videoId) && !seen.has(item.videoId) && out.length < 20) { seen.add(item.videoId); out.push(item); } };
  for (const v of videos.filter((t) => t.videoId && (!t.duration || t.duration <= 900)).slice(0, 4)) {
    const parsed = parseFanUpload(v.title);
    const artist = parsed.candidateArtist ?? (/artista por identificar/i.test(v.artist) ? "YouTube" : v.artist);
    push({ videoId: v.videoId!, title: parsed.title.replace(/\s*[([][^)\]]*[)\]]/g, "").trim() || v.title, artist, duration: v.duration, artworkUrl: v.artworkUrl });
  }
  for (const s of songs) push({ videoId: s.videoId, title: s.title, artist: s.artist, album: s.album, duration: s.duration, artworkUrl: s.artworkUrl });
  return out;
}

const NOT_DJ = "Solo los DJ de la JAM pueden hacer esto. Pídele al anfitrión que te haga DJ.";
const isDj = (id: string) => !!session?.guests.find((g) => g.id === id)?.dj;

/** The owner turns a guest into a DJ (pause, skip, put songs first) or back. */
export function setGuestDj(id: string, dj: boolean) {
  if (!session) return;
  session = { ...session, guests: session.guests.map((g) => (g.id === id ? { ...g, dj } : g)) };
  changed();
  publish(true);
}

async function handle(request: JamRequest): Promise<{ status: number; body: unknown }> {
  const guest = guestOf(request);
  seen(guest);
  const body = (() => { try { return request.body ? JSON.parse(request.body) : {}; } catch { return {}; } })();
  switch (request.name) {
    case "hello":
      changed();
      return { status: 200, body: { ok: true, name: guest.name } };
    case "search":
      return { status: 200, body: { results: await search(request.params.q ?? "") } };
    case "add": {
      const videoId = clean(body.videoId, 11);
      const title = clean(body.title);
      if (!VIDEO.test(videoId) || !title) return { status: 400, body: { error: "Esa canción no se puede añadir." } };
      const now = Date.now();
      const recent = (adds.get(guest.id) ?? []).filter((at) => now - at < 10 * 60_000);
      if (recent.length >= MAX_ADDS) return { status: 429, body: { error: "Ya añadiste muchas canciones. Espera unos minutos." } };
      const state = player.getSnapshot();
      if (state.queue.slice(state.index).some((t) => t.videoId === videoId)) return { status: 200, body: { ok: true, already: true } };
      adds.set(guest.id, [...recent, now]);
      const track: QueueItem = {
        id: "yt:" + videoId, videoId, source: "youtube", title, artist: clean(body.artist) || "YouTube",
        album: clean(body.album) || undefined, duration: Number.isFinite(body.duration) ? Math.max(0, Math.min(36_000, body.duration)) : 0,
        artworkUrl: /^https:\/\/[^\s"']+$/.test(body.artworkUrl ?? "") ? String(body.artworkUrl).slice(0, 600) : undefined,
        tags: [], jamGuest: guest,
      };
      // A DJ can put it first: right after the song that is playing, before everything else.
      if (!state.queue.length) await player.playList([{ ...track }]);
      else if (body.next === true && isDj(guest.id)) {
        const queue = [...state.queue];
        queue.splice(state.index + 1, 0, { ...track, queueId: crypto.randomUUID(), userQueued: true });
        player.reorder(queue);
      } else player.enqueue(track);
      if (session) session = { ...session, guests: session.guests.map((g) => (g.id === guest.id ? { ...g, added: g.added + 1 } : g)) };
      changed();
      publish(true);
      return { status: 200, body: { ok: true } };
    }
    case "move": {
      const queueId = clean(body.queueId, 60);
      const to = Number(body.to);
      const state = player.getSnapshot();
      const upcoming = state.queue.slice(state.index + 1);
      const from = upcoming.findIndex((t) => t.queueId === queueId);
      if (from < 0 || !Number.isInteger(to) || to < 0 || to >= upcoming.length) return { status: 400, body: { error: "Esa canción ya no está en la cola." } };
      // What plays next is a DJ's call.
      if ((to === 0 || from === 0) && !isDj(guest.id)) return { status: 403, body: { error: NOT_DJ } };
      const [item] = upcoming.splice(from, 1);
      upcoming.splice(to, 0, item);
      player.reorder([...state.queue.slice(0, state.index + 1), ...upcoming]);
      publish(true);
      return { status: 200, body: { ok: true } };
    }
    case "remove": {
      const queueId = clean(body.queueId, 60);
      const state = player.getSnapshot();
      const at = state.queue.findIndex((t, i) => i > state.index && t.queueId === queueId);
      // A guest only takes out what a guest added; the owner's songs stay.
      if (at < 0 || !state.queue[at].jamGuest) return { status: 403, body: { error: "Solo puedes quitar canciones que añadió la JAM." } };
      player.reorder(state.queue.filter((_, i) => i !== at));
      publish(true);
      return { status: 200, body: { ok: true } };
    }
    case "control": {
      if (!isDj(guest.id)) return { status: 403, body: { error: NOT_DJ } };
      const action = clean(body.action, 12);
      if (action === "toggle") await player.toggle();
      else if (action === "next") await player.next();
      else if (action === "previous") await player.previous();
      else return { status: 400, body: { error: "Acción desconocida" } };
      publish(true);
      return { status: 200, body: { ok: true } };
    }
    default:
      return { status: 404, body: { error: "No encontrado" } };
  }
}

export async function startJam(): Promise<JamSession> {
  if (!isNative) throw new Error("El JAM funciona en la app de MURMUR para Android.");
  const started = await Jam.start();
  if (!session) {
    session = { url: started.url, startedAt: Date.now(), guests: [] };
    listener ??= await Jam.addListener("jamRequest", (request) => {
      void handle(request)
        .catch(() => ({ status: 500, body: { error: "Algo falló en MURMUR. Intenta de nuevo." } }))
        .then(({ status, body }) => Jam.respond({ id: request.id, status, body: JSON.stringify(body) }).catch(() => {}));
    });
    unsubscribe = player.subscribe(() => publish());
  } else session = { ...session, url: started.url };
  lastPublished = "";
  publish(true);
  changed();
  return session;
}

/** The QR changes when the phone moves to another Wi-Fi or turns its hotspot on. */
export async function refreshJamAddress() {
  if (!session) return;
  const { url } = await Jam.address().catch(() => ({ url: undefined }));
  if (url && url !== session.url) { session = { ...session, url }; changed(); }
}

export async function stopJam() {
  await Jam.stop().catch(() => {});
  await listener?.remove().catch(() => {});
  listener = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  clearTimeout(publishTimer);
  session = undefined;
  adds.clear();
  changed();
}
