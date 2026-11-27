import { Audio, Auth, isNative } from "../native";
import type { QueueItem, MixMode } from "./types";
import { recordListening } from "./DiscoveryEngine";
import { parseChapters } from "./FanUploadParser";
import { db } from "./db";
import { SelectionTimer } from "./PlaybackMetrics";
import { anotherVersion, bridged, setSpotifyViaYouTube, spotifyViaYouTube, youtubeTwin } from "./spotifyBridge";
import { interleaveMagic } from "./magicShuffle";
import { CONTINUE_BATCH, CONTINUE_WHEN_LEFT, continuationPicks, moodPicks } from "./continuation";
import { moodByKey, nextMood } from "./moods";
export interface PlayerState {
  queue: QueueItem[];
  index: number;
  playing: boolean;
  loading: boolean;
  position: number;
  /** Real length of what is playing, in seconds, as the engine reports it; 0 until known. */
  duration: number;
  mode: MixMode;
  error: string;
  errorCode: string;
  deviceName: string;
  carMode: boolean;
  shuffled: boolean;
  /** off → on (shuffle) → magic (shuffle + related songs) → off, like the shuffle button cycles. */
  shuffleMode: "off" | "on" | "magic";
}
/** Native errors that mean "this upload will never play here" (not a network hiccup). */
const SESSION_KEY = "murmur.session";
const UNPLAYABLE = new Set(["AUDIO_UNAVAILABLE", "YOUTUBE_CONTENT_UNAVAILABLE", "YOUTUBE_PRIVATE_ACCESS_DENIED"]);
export class AudioOrchestrator {
  private state: PlayerState = {
    queue: [],
    index: 0,
    playing: false,
    loading: false,
    position: 0,
    duration: 0,
    mode: "smooth",
    error: "",
    errorCode: "",
    deviceName: "",
    carMode: false,
    shuffled: false,
    shuffleMode: "off",
  };
  /** Upcoming order before shuffling, to put it back when shuffle is turned off. */
  private originalOrder: string[] = [];
  /**
   * The shuffle button: 1st tap shuffles, 2nd adds related songs ("Aleatorio mágico"), 3rd restores
   * the original order and removes the added songs. Returns a short message for the UI.
   */
  async cycleShuffle(pickMagic: (queue: QueueItem[], current: QueueItem | undefined, count: number) => Promise<QueueItem[]>) {
    const mode = this.state.shuffleMode;
    // What follows was chosen by MURMUR (a song on its own, or the end of a list): shuffling it would
    // only reorder the same songs, so each press brings a new selection instead.
    if (mode !== "magic" && this.autoUpcoming()) {
      const count = await this.freshSelection();
      this.update({ shuffleMode: mode === "off" ? "on" : "magic", shuffled: true });
      return count ? `Nueva selección: ${count} canciones` : "No encontré otras canciones afines ahora.";
    }
    if (mode === "off") {
      this.originalOrder = this.state.queue.slice(this.state.index + 1).map((t) => t.queueId!);
      this.reshuffle();
      this.update({ shuffleMode: "on", shuffled: true });
      return "Aleatorio activado";
    }
    if (mode === "on") {
      this.update({ shuffleMode: "magic" });
      const generation = this.generation;
      const upcoming = this.state.queue.slice(this.state.index + 1);
      const wanted = Math.min(30, Math.max(3, Math.ceil(upcoming.length / 3)));
      const picks = (await pickMagic(this.state.queue, this.current, wanted).catch(() => []))
        .map((t) => ({ ...t, queueId: crypto.randomUUID(), smart: true }));
      if (this.state.shuffleMode !== "magic") return "";
      if (!picks.length) return "Aleatorio mágico activado: no encontré canciones afines ahora.";
      const live = this.state.queue.slice(this.state.index + 1);
      const mixed = interleaveMagic(live, picks);
      this.update({ queue: [...this.state.queue.slice(0, this.state.index + 1), ...mixed] });
      this.syncQueue();
      void generation;
      return `Aleatorio mágico: agregué ${picks.length} canciones afines.`;
    }
    // Back to normal: drop the added songs and restore the original order of what remains.
    const head = this.state.queue.slice(0, this.state.index + 1);
    const rest = this.state.queue.slice(this.state.index + 1).filter((t) => !t.smart || t.continuation);
    const position = new Map(this.originalOrder.map((id, i) => [id, i]));
    const known = rest.filter((t) => position.has(t.queueId!)).sort((a, b) => position.get(a.queueId!)! - position.get(b.queueId!)!);
    const added = rest.filter((t) => !position.has(t.queueId!));
    this.update({ queue: [...head, ...known, ...added], shuffleMode: "off", shuffled: false });
    this.syncQueue();
    return "Aleatorio desactivado";
  }
  /** True when every song after the current one was added by MURMUR (none chosen by the listener). */
  autoUpcoming() {
    if (!this.current) return false;
    return this.state.queue.slice(this.state.index + 1).every((t) => t.continuation && !t.userQueued && !t.jamGuest);
  }
  /** Replaces MURMUR's songs after the current one with a new selection, never the same songs. */
  async freshSelection(): Promise<number> {
    const current = this.current;
    if (!current) return 0;
    const head = this.state.queue.slice(0, this.state.index + 1);
    const previous = this.state.queue.slice(this.state.index + 1);
    const picks = await continuationPicks(head, current, CONTINUE_BATCH, undefined, previous).catch(() => [] as QueueItem[]);
    if (this.current?.queueId !== current.queueId || !picks.length) return 0;
    // Songs a guest or the listener queued meanwhile stay.
    const kept = this.state.queue.slice(this.state.index + 1).filter((t) => !t.continuation || t.userQueued || t.jamGuest);
    this.update({ queue: [...this.state.queue.slice(0, this.state.index + 1), ...kept, ...picks.map((t) => ({ ...t, queueId: crypto.randomUUID() }))] });
    this.syncQueue();
    void this.bridgeUpcoming();
    return picks.length;
  }
  private listeners = new Set<() => void>();
  private generation = 0;
  private poll?: ReturnType<typeof setInterval>;
  private initialized = false;
  private loadedId = "";
  private loadedSource: "youtube" | "spotify" | undefined;
  private spotifyTransport = "connect";
  /** Queue entry whose Spotify player failed: it plays its YouTube Music twin this one time. */
  private twinOnce = "";
  private queueTimer?: ReturnType<typeof setTimeout>;
  private loadingTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private seekTimer?: ReturnType<typeof setTimeout>;
  private finishSeek?: () => void;
  /** Target of the last seek: progress ticks far from it are stale until it lands (or 1.5 s pass). */
  private seekGuard?: { to: number; until: number };
  private pausedAt = 0;
  /**
   * Paused in MURMUR, then resumed from the notification, headphones or lock screen: the engine
   * says it plays this same song again. Events are trusted again, or the slider would stay frozen.
   */
  private externalResume(e: { playing?: boolean; queueId?: string; trackId?: string }) {
    if (!this.ignoreNative || !e.playing || Date.now() - this.pausedAt < 800) return;
    if ((e.queueId && e.queueId !== this.current?.queueId) || (e.trackId && e.trackId !== this.current?.id)) return;
    this.ignoreNative = false;
    if (this.current) this.loadedId = this.current.id;
  }
  private ignoreNative = false;
  /** Measures tap-to-playback for the newest explicit selection only. */
  readonly selection = new SelectionTimer();
  private clearLoadingTimer() {
    clearTimeout(this.loadingTimer);
    this.loadingTimer = undefined;
  }
  private accepts(event: { trackId?: string; queueId?: string }) {
    return (
      !this.ignoreNative &&
      (!event.queueId || event.queueId === this.current?.queueId) &&
      (!event.trackId || event.trackId === this.current?.id)
    );
  }
  private syncQueue(immediate = false) {
    clearTimeout(this.queueTimer);
    const sync = () => {
      if (isNative && this.current)
        void Audio.setQueue({
          tracks: this.state.queue.slice(this.state.index + 1),
          previous: this.state.queue.slice(0, this.state.index),
          currentQueueId: this.current.queueId,
        }).catch(() => {});
    };
    if (immediate) sync();
    else this.queueTimer = setTimeout(sync, 100);
  }
  reshuffle(random = Math.random) {
    const start = this.state.index + 1;
    const upcoming = this.state.queue.slice(start);
    if (upcoming.length < 2) return;
    const before = upcoming.map((t) => t.queueId || t.id).join("|");
    for (let i = upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }
    if (upcoming.map((t) => t.queueId || t.id).join("|") === before)
      upcoming.push(upcoming.shift()!);
    this.reorder([...this.state.queue.slice(0, start), ...upcoming]);
    this.update({ shuffled: true });
  }
  reorderUpcoming(ids: string[]) {
    const upcoming = this.state.queue.slice(this.state.index + 1);
    if (ids.length !== upcoming.length || new Set(ids).size !== ids.length)
      return;
    const byId = new Map(upcoming.map((t) => [t.queueId!, t]));
    if (ids.some((id) => !byId.has(id))) return;
    this.reorder([
      ...this.state.queue.slice(0, this.state.index + 1),
      ...ids.map((id) => byId.get(id)!),
    ]);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(patch: Partial<PlayerState>) {
    if (patch.loading === false || patch.playing === true || patch.error) this.clearLoadingTimer();
    const before = this.current?.queueId ?? this.current?.id;
    this.state = { ...this.state, ...patch };
    const after = this.current?.queueId ?? this.current?.id;
    if (before !== after && patch.duration === undefined) this.state.duration = 0;
    if (this.state.loading && !this.loadingTimer) {
      const generation = this.generation;
      this.loadingTimer = setTimeout(() => {
        this.loadingTimer = undefined;
        if (generation !== this.generation || !this.state.loading) return;
        void this.pause();
        this.update({
          error: "La fuente tardó demasiado. Revisa tu conexión y pulsa Reintentar.",
          errorCode: "PLAYBACK_TIMEOUT",
        });
      }, 30000);
    }
    this.selection.observe({
      queueId: this.current?.queueId,
      playing: this.state.playing,
      loading: this.state.loading,
      error: this.state.error,
      errorCode: this.state.errorCode,
    });
    this.listeners.forEach((l) => l());
    this.scheduleSessionSave();
  }
  private sessionTimer?: ReturnType<typeof setTimeout>;
  /** Saved at most every 4 s (and right away when MURMUR goes to the background). */
  private scheduleSessionSave() {
    if (this.sessionTimer || !this.current) return;
    this.sessionTimer = setTimeout(() => { this.sessionTimer = undefined; this.saveSession(); }, 4000);
  }
  /**
   * "Where I left off": the queue around the current song, the song and the second, kept on the
   * phone so reopening MURMUR (even after Android closed it) shows the same song ready to continue.
   */
  saveSession() {
    if (typeof localStorage === "undefined" || !this.current) return;
    const start = Math.max(0, this.state.index - 30);
    const queue = this.state.queue.slice(start, this.state.index + 120)
      .map(({ description: _d, chapters: _c, ...rest }) => rest);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        queue, index: this.state.index - start, position: Math.floor(this.state.position), mode: this.state.shuffleMode, at: Date.now(),
      }));
    } catch { /* Storage full: the next save will try again with less. */ }
  }
  private restoreSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as
        { queue: QueueItem[]; index: number; position: number } | null;
      if (!saved?.queue?.length || !saved.queue[saved.index]) return;
      const current = saved.queue[saved.index];
      // Near the end of the song: start the next one instead of its last seconds.
      const nearEnd = current.duration > 0 && saved.position > current.duration - 8;
      const index = nearEnd && saved.queue[saved.index + 1] ? saved.index + 1 : saved.index;
      const position = index === saved.index && !nearEnd ? saved.position : 0;
      this.resumeAt = { queueId: saved.queue[index].queueId, ms: position * 1000 };
      this.loadedId = "";
      this.update({ queue: saved.queue, index, position, playing: false, loading: false });
      this.syncQueue();
    } catch { /* A damaged save is ignored. */ }
  }
  /** Second to start from on the next play of the restored song. */
  private resumeAt?: { queueId?: string; ms: number };
  get current() {
    return this.state.queue[this.state.index];
  }
  get nextTrack() {
    return this.state.queue[this.state.index + 1];
  }
  async init() {
    if (this.initialized) return;
    this.initialized = true;
    const restoreGeneration = this.generation;
    const mode = (await db.settings.get("mixMode"))?.value as
      MixMode | undefined;
    if (mode) this.update({ mode });
    if (!isNative) return;
    if (mode) await Audio.setAutoMixMode({ mode }).catch(() => {});
    await Audio.addListener("onPlaybackProgress", (e) => {
      if (this.current?.source === "youtube" && !this.state.error && this.accepts(e)) {
        const position = e.positionMs / 1000;
        // A tick sent before the seek reached the engine would pull the thumb back to the old spot.
        if (this.seekGuard) {
          if (Date.now() < this.seekGuard.until && Math.abs(position - this.seekGuard.to) > 1.5) return;
          this.seekGuard = undefined;
        }
        this.update({ position, ...(e.durationMs > 0 ? { duration: e.durationMs / 1000 } : {}) });
      }
    });
    await Audio.addListener("onPlaybackStateChanged", (e) => {
      this.externalResume(e);
      if (this.current?.source === "youtube" && !this.state.error && this.accepts(e))
        this.update({ playing: e.playing, loading: e.loading || false });
    });
    await Audio.addListener("onTrackEnded", (event) => {
      if (this.current?.source === "youtube" && this.accepts(event ?? {}) && !this.state.error)
        void this.next(false);
    });
    await Audio.addListener("onSpotifyEngineState", (event) => {
      if (
        this.state.error || !this.accepts(event) || this.current?.source !== "spotify"
      ) return;
      this.update({
        playing: event.playing,
        loading: event.loading,
        position: event.positionMs / 1000,
      });
    });
    await Audio.addListener("onSpotifyEngineError", (event) => {
      if (
        !this.accepts(event) ||
        this.current?.source !== "spotify" ||
        (event.trackId && event.trackId !== this.current.id)
      )
        return;
      this.loadedId = "";
      // Spotify refused its own playback here: play the YouTube Music twin with MURMUR's engine
      // from now on (no Spotify app needed), starting with this same song.
      if (event.code === "SPOTIFY_RETRY_YOUTUBE") {
        // A route that can never work here is remembered; a single failing song plays its twin once.
        if (event.permanent === false) this.twinOnce = this.current.queueId ?? "";
        else setSpotifyViaYouTube(true);
        this.update({ error: "", errorCode: "", loading: true, playing: false });
        void this.playCurrent();
        return;
      }
      // Any other failure of Spotify's player: the twin plays this song instead of silence.
      const queueId = this.current.queueId;
      if (queueId && this.twinOnce !== queueId) {
        this.twinOnce = queueId;
        this.update({ error: "", errorCode: "", loading: true, playing: false });
        void this.playCurrent();
        return;
      }
      this.update({
        playing: false,
        loading: false,
        error:
          event.message || "El motor integrado no pudo reproducir esta pista.",
        errorCode: event.code || "SPOTIFY_ENGINE_FAILED",
      });
    });
    await Audio.addListener("onNativeTrackChanged", (e) => {
      if (this.ignoreNative && Date.now() - this.pausedAt > 800) this.ignoreNative = false;
      const index = this.state.queue.findIndex((t) =>
        e.queueId ? t.queueId === e.queueId : t.id === e.id,
      );
      if (index >= 0 && !this.ignoreNative) {
        if (index === this.state.index && e.prepared !== false && this.state.error) return;
        this.generation++;
        this.clearLoadingTimer();
        const previous = this.current;
        const position = this.state.position;
        if (previous) void recordListening(previous, position, false);
        this.loadedId = e.prepared === false ? "" : e.id;
        this.loadedSource = this.state.queue[index].source;
        if (e.transport) this.spotifyTransport = e.transport;
        this.update({
          index,
          position: typeof e.positionMs === "number" && e.positionMs > 0 ? e.positionMs / 1000 : 0,
          duration: typeof e.durationMs === "number" && e.durationMs > 0 ? e.durationMs / 1000 : 0,
          error: "",
          errorCode: "",
          playing: e.playing ?? true,
          loading: e.loading ?? false,
          deviceName: e.transport === "integrated" ? "MURMUR · Integrado" : "",
        });
        this.scheduleContinuation();
      }
    });
    await Audio.addListener("onTrackError", (event) => {
      if (this.current?.source !== "youtube" || !this.accepts(event)) return;
      if (event.trackId && event.trackId !== this.current.id) return;
      this.loadedId = "";
      // Blocked or removed upload: play another version of the same song, else the next song.
      if (UNPLAYABLE.has(event.code)) {
        void this.replaceUnplayable(this.current);
        return;
      }
      this.update({
        error:
          event.message || "No se pudo abrir el audio. Prueba otra versión.",
        errorCode: event.code || "AUDIO_PLAYBACK_FAILED",
        ...(typeof event.positionMs === "number" ? { position: event.positionMs / 1000 } : {}),
        playing: false,
        loading: false,
      });
    });
    await Audio.addListener("onRequestNext", () => void this.next());
    await Audio.addListener("onRequestPrevious", () => void this.previous());
    await Audio.addListener("onCarModeChanged", (e) =>
      this.update({ carMode: e.connected }),
    );
    const native = await Audio.getState().catch(() => undefined);
    if (native?.track && restoreGeneration === this.generation && !this.current) {
      const restoredQueue = native.queue?.length
        ? native.queue
        : [native.track];
      const restoredIndex = Math.max(
        0,
        restoredQueue.findIndex((t) =>
          native.track?.queueId
            ? t.queueId === native.track.queueId
            : t.id === native.track?.id,
        ),
      );
      this.spotifyTransport = native.transport || "connect";
      this.loadedId = native.track.id;
      this.loadedSource = native.track.source;
      this.update({
        queue: restoredQueue,
        index: restoredIndex,
        position: native.positionMs / 1000,
        duration: native.durationMs > 0 ? native.durationMs / 1000 : 0,
        playing: native.playing,
        loading: native.loading || false,
      });
    } else if (restoreGeneration === this.generation && !this.current) this.restoreSession();
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") this.saveSession(); });
    this.poll = setInterval(() => {
      // A paused Spotify track in a hidden app has nothing to sync: skip the request (data and battery).
      const idle = !this.state.playing && !this.state.loading &&
        typeof document !== "undefined" && document.visibilityState === "hidden";
      if (this.current?.source === "spotify") { if (!idle) void this.pollSpotify(); }
      else if (this.state.loading && !this.ignoreNative) void this.reconcile();
    }, 2000);
    await Audio.setAutoMixMode({ mode: this.state.mode });
  }
  async playList(queue: QueueItem[], index = 0) {
    this.generation++;
    this.context++;
    this.update({
      queue: queue.map((track) => ({ ...track, userQueued: undefined, queueId: crypto.randomUUID() })),
      index,
      position: 0,
      playing: false,
      shuffled: false,
      shuffleMode: "off",
      error: "",
      errorCode: "",
    });
    this.originalOrder = [];
    await this.playCurrent();
  }
  /** Resolves the YouTube twins of the next Spotify entries so the native queue can preload them. */
  private async bridgeUpcoming(count = 3) {
    const generation = this.generation;
    const pending = this.state.queue.slice(this.state.index + 1, this.state.index + 1 + count)
      .filter((t) => t.source === "spotify");
    let changed = false;
    for (const entry of pending) {
      const twin = await youtubeTwin(entry).catch(() => undefined);
      if (generation !== this.generation || !twin) continue;
      const queue = [...this.state.queue];
      const at = queue.findIndex((t) => t.queueId === entry.queueId);
      if (at < 0 || queue[at].source !== "spotify") continue;
      queue[at] = bridged(queue[at], twin);
      this.update({ queue });
      changed = true;
    }
    if (changed) this.syncQueue();
  }
  async playCurrent() {
    let track = this.current;
    if (!track) {
      this.update({ playing: false, loading: false });
      return;
    }
    this.scheduleContinuation();
    const retry = this.state.errorCode === "AUDIO_NOT_FOUND"
      ? { refreshSource: true, positionMs: Math.round(this.state.position * 1000), offlinePath: undefined }
      : this.state.error ? { refreshSource: true, positionMs: Math.round(this.state.position * 1000) } : undefined;
    const generation = ++this.generation;
    this.ignoreNative = false;
    this.loadedId = "";
    this.clearLoadingTimer();
    this.selection.start(track.queueId, track.source);
    this.update({ loading: true, playing: false, error: "", errorCode: "" });
    try {
      if (!isNative)
        throw new Error(
          "La reproducción requiere la app Android. Puedes explorar y gestionar tu biblioteca aquí.",
        );
      if (track.source === "spotify" && (spotifyViaYouTube() || this.twinOnce === track.queueId)) {
        // YouTube Music's twin first, then any other upload of the same song.
        const twin = (await youtubeTwin(track).catch(() => undefined)) ?? (await anotherVersion(track));
        if (generation !== this.generation) return;
        if (!twin)
          throw Object.assign(new Error("No encontré esta canción de Spotify en YouTube. Sigo con la siguiente."), { code: "SPOTIFY_NO_TWIN" });
        track = bridged(track, twin);
        const queue = [...this.state.queue];
        queue[this.state.index] = track;
        this.update({ queue });
      }
      if (track.source === "spotify") {
        // The native Spotify load switches and pauses the previous source atomically.
        if (generation !== this.generation) return;
        if (!track.spotifyUri)
          throw new Error("Esta canción no tiene un enlace de Spotify válido.");
        const device = await Auth.playSpotify({
          ...track,
          uri: track.spotifyUri,
        });
        if (generation !== this.generation || this.state.error) return;
        this.spotifyTransport = device?.transport || "connect";
        this.update({
          deviceName: device?.deviceName || "",
          playing: device?.playing ?? true,
          loading: device?.loading ?? false,
        });
      } else {
        if (
          this.loadedSource === "spotify" &&
          this.spotifyTransport !== "integrated"
        ) {
          void Auth.spotifyRequest({
            path: "/me/player/pause",
            method: "PUT",
          }).catch(() => {});
        }
        const resume = this.resumeAt && this.resumeAt.queueId === track.queueId && this.resumeAt.ms > 3000 ? this.resumeAt.ms : 0;
        this.resumeAt = undefined;
        const info = await Audio.extractAndPlay(retry ? { ...track, ...retry } : resume ? { ...track, startAtMs: resume } : track);
        if (generation !== this.generation || this.state.error) return;
        this.update({ deviceName: "" });
        const updated = {
          ...track,
          duration: info.duration || track.duration,
          description: info.description,
          chapters: parseChapters(
            info.description,
            info.duration || track.duration,
          ),
        };
        const queue = [...this.state.queue];
        queue[this.state.index] = updated;
        this.update({ queue, ...(info.duration > 0 ? { duration: info.duration } : {}) });
        this.update({
          playing: info.playing ?? true,
          loading: info.loading ?? false,
        });
      }
      if (generation === this.generation) {
        this.unplayableRun = 0;
        this.loadedId = track.id;
        this.loadedSource = track.source;
        this.update({
          ...(track.source === "spotify" &&
          this.spotifyTransport !== "integrated"
            ? { playing: true, loading: false }
            : {}),
        });
        this.syncQueue(true);
        if (spotifyViaYouTube()) void this.bridgeUpcoming();
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Spotify's player could not start this song (account signed out, a permission missing, no
      // Premium): play its YouTube Music twin instead of stopping, once per queue entry.
      const original = this.state.queue[this.state.index];
      if (generation === this.generation && original?.source === "spotify" && original.queueId &&
          this.twinOnce !== original.queueId && !spotifyViaYouTube()) {
        this.twinOnce = original.queueId;
        this.update({ error: "", errorCode: "" });
        void this.playCurrent();
        return;
      }
      // A song with no playable version anywhere is skipped, so the music doesn't stop.
      if (generation === this.generation && code === "SPOTIFY_NO_TWIN" && this.skipUnplayable()) return;
      if (generation === this.generation && !this.state.error)
        this.update({
          loading: false,
          playing: false,
          error: (error as Error).message,
          errorCode: (error as { code?: string }).code || "PLAYBACK_FAILED",
        });
    }
  }
  /** Songs skipped in a row because no version could play: stops after a few to avoid a loop. */
  private unplayableRun = 0;
  private skipUnplayable() {
    if (++this.unplayableRun > 4) { this.unplayableRun = 0; return false; }
    this.update({ loading: true, error: "", errorCode: "" });
    void this.next(false);
    return true;
  }
  /** Another upload of the same song when this one is blocked or removed; otherwise the next song. */
  private async replaceUnplayable(track: QueueItem) {
    const generation = this.generation;
    this.update({ loading: true, playing: false, error: "", errorCode: "" });
    const other = await anotherVersion(track, track.videoId).catch(() => undefined);
    if (generation !== this.generation || this.current?.queueId !== track.queueId) return;
    if (!other) { if (!this.skipUnplayable()) this.update({ loading: false, error: "No encontré otra versión que se pueda reproducir.", errorCode: "AUDIO_UNAVAILABLE" }); return; }
    const queue = [...this.state.queue];
    queue[this.state.index] = { ...track, videoId: other.videoId, duration: track.duration || other.duration, offlinePath: undefined };
    this.update({ queue });
    await this.playCurrent();
  }
  /** Changes only when a new list starts, so a late continuation never lands in another context. */
  private context = 0;
  private extending?: Promise<void>;
  /** Turned off by tests and by "pause at the end of this song". */
  continueAutomatically = true;
  /**
   * "La música no se detiene": with two songs or fewer left, appends related songs (and recently
   * played ones) so the queue never runs out, never repeating a song that is already in it.
   */
  private continuationTimer?: ReturnType<typeof setTimeout>;
  /** A few seconds after a song starts, so finding more music never competes with starting this one. */
  private scheduleContinuation() {
    clearTimeout(this.continuationTimer);
    this.continuationTimer = setTimeout(() => void this.ensureContinuation(), 4000);
  }
  /**
   * What the endless queue adds next. A mood the listener asked for ("pon algo triste") goes on;
   * with the presenter talking in blocks and "cambiar de ambiente" on, each block is a new mood;
   * otherwise songs related to what played.
   */
  private async nextBlock(): Promise<QueueItem[]> {
    const current = this.current;
    const asked = current?.moodAsked ? moodByKey(current.moodKey) : undefined;
    if (asked) {
      const picks = await moodPicks(asked, this.state.queue, CONTINUE_BATCH, true).catch(() => []);
      if (picks.length) return picks;
    } else {
      const prefs = await Audio.voicePrefs().catch(() => undefined);
      const every = prefs?.every ?? 1;
      // Mood blocks only go on when what plays already comes from a mood: after a song the listener
      // chose (a search, a voice request, an album), the endless queue follows that song instead.
      if (prefs?.presenter && every > 1 && prefs.moods !== false && current?.moodKey) {
        const last = [...this.state.queue].reverse().find((t) => t.moodKey)?.moodKey;
        const picks = await moodPicks(nextMood(last), this.state.queue, Math.max(every, CONTINUE_BATCH), false).catch(() => []);
        if (picks.length) return picks;
      }
    }
    return continuationPicks(this.state.queue, current);
  }
  ensureContinuation(): Promise<void> | undefined {
    if (!isNative || !this.continueAutomatically || this.extending || !this.current) return this.extending;
    if (this.state.queue.length - 1 - this.state.index > CONTINUE_WHEN_LEFT) return;
    const context = this.context;
    this.extending = (async () => {
      const picks = await this.nextBlock();
      if (context !== this.context || !picks.length) return;
      this.update({ queue: [...this.state.queue, ...picks.map((t) => ({ ...t, queueId: crypto.randomUUID() }))] });
      this.syncQueue();
      void this.bridgeUpcoming();
    })().catch(() => {}).finally(() => { this.extending = undefined; });
    return this.extending;
  }
  /**
   * Queues a track right after the current one and after everything the user already queued,
   * so several additions play in the order they were added (like "Añadir a la cola" elsewhere).
   */
  enqueue(tracks: QueueItem | QueueItem[]) {
    const added = (Array.isArray(tracks) ? tracks : [tracks])
      .map((track) => ({ ...track, queueId: crypto.randomUUID(), userQueued: true }));
    if (!added.length) return;
    const queue = [...this.state.queue];
    if (!queue.length) {
      this.update({ queue: added, index: 0 });
      return;
    }
    let at = this.state.index + 1;
    while (at < queue.length && queue[at].userQueued) at++;
    queue.splice(at, 0, ...added);
    this.update({ queue });
    this.syncQueue();
  }
  reorder(queue: QueueItem[]) {
    const used = new Set<string>();
    queue = queue.map((track) => {
      if (track.queueId) {
        used.add(track.queueId);
        return track;
      }
      const old = this.state.queue.find(
        (entry) =>
          entry.id === track.id && entry.queueId && !used.has(entry.queueId),
      );
      const key = old?.queueId || crypto.randomUUID();
      used.add(key);
      return { ...track, queueId: key };
    });
    const current = this.current;
    const id = current?.queueId;
    this.update({
      queue,
      index: Math.max(
        0,
        queue.findIndex((t) => (id ? t.queueId === id : t.id === current?.id)),
      ),
    });
    this.syncQueue();
  }
  async playQueueEntry(queueId: string) {
    const index = this.state.queue.findIndex((t) => t.queueId === queueId);
    if (index < 0) return;
    if (this.current)
      void recordListening(this.current, this.state.position, true).catch(
        () => {},
      );
    this.update({
      queue: this.state.queue.slice(index),
      index: 0,
      position: 0,
      error: "",
      errorCode: "",
    });
    await this.playCurrent();
  }
  async next(skipped = true) {
    const previous = this.current;
    const position = this.state.position;
    if (previous)
      void recordListening(previous, position, skipped).catch(() => {});
    // End of the queue: wait for the continuation instead of stopping.
    if (!this.nextTrack) await this.ensureContinuation();
    if (!this.nextTrack) return this.pause();
    this.update({ index: this.state.index + 1, position: 0, error: "", errorCode: "" });
    await this.playCurrent();
  }
  async previous() {
    if (this.state.position > 3 && !this.state.loading) return this.seek(0);
    if (this.state.index === 0) return this.seek(0);
    this.update({ index: this.state.index - 1, position: 0, error: "", errorCode: "" });
    await this.playCurrent();
  }
  async pause() {
    const generation = ++this.generation;
    const remoteSpotify = this.loadedSource === "spotify" && this.spotifyTransport !== "integrated";
    this.ignoreNative = true;
    this.pausedAt = Date.now();
    this.clearLoadingTimer();
    this.selection.cancel();
    if (this.state.loading) this.loadedId = "";
    this.update({ playing: false, loading: false });
    try {
      if (isNative) {
        await Audio.pause();
        if (generation === this.generation && remoteSpotify)
          await Auth.spotifyRequest({
            path: "/me/player/pause",
            method: "PUT",
          });
      }
    } catch (error) {
      if (generation === this.generation && !this.state.error)
        this.update({ error: (error as Error).message });
    }
  }
  async refreshNativeState() {
    if (!isNative) return;
    const generation = this.generation;
    const native = await Audio.getState().catch(() => undefined);
    if (!native?.track || generation !== this.generation) return;
    const index = this.state.queue.findIndex((t) =>
      native.track?.queueId
        ? t.queueId === native.track.queueId
        : t.id === native.track?.id,
    );
    // During an explicit load the service may still be finishing playback of the outgoing entry.
    if (this.state.loading && index !== this.state.index) return;
    if (index >= 0 && (native.playing || native.loading)) {
      this.ignoreNative = false;
      this.loadedId = native.track.id;
      this.loadedSource = native.track.source;
      this.update({
        index,
        position: native.positionMs / 1000,
        ...(native.durationMs > 0 ? { duration: native.durationMs / 1000 } : {}),
        playing: native.playing,
        loading: native.loading ?? false,
      });
    }
  }
  private async reconcile() {
    const generation = this.generation;
    const native = await Audio.getState().catch(() => undefined);
    if (!native || generation !== this.generation || this.ignoreNative || this.state.error) return;
    if (
      native.track &&
      (native.track.queueId
        ? native.track.queueId === this.current?.queueId
        : native.track.id === this.current?.id)
    )
      this.update({
        playing: native.playing,
        loading: native.loading ?? false,
        position: native.positionMs / 1000,
        ...(native.durationMs > 0 ? { duration: native.durationMs / 1000 } : {}),
      });
  }
  async toggle() {
    const generation = this.generation;
    try {
      if (this.state.playing || this.state.loading) return await this.pause();
      if (!isNative || this.state.error || this.loadedId !== this.current?.id)
        return await this.playCurrent();
      this.ignoreNative = false;
      if (this.current?.source === "spotify")
        await Auth.spotifyRequest({ path: "/me/player/play", method: "PUT" });
      else await Audio.resume();
      if (generation === this.generation && !this.state.error)
        this.update({ playing: true, loading: false, error: "", errorCode: "" });
    } catch (e) {
      if (generation !== this.generation || this.state.error) return;
      this.update({
        error: (e as Error).message,
        loading: false,
        playing: false,
      });
    }
  }
  async seek(seconds: number) {
    if (!isNative || !this.current) return;
    const length = this.state.duration || this.current.duration || seconds;
    const position = Math.max(0, Math.min(seconds, length));
    this.seekGuard = { to: position, until: Date.now() + 1500 };
    this.update({ position });
    clearTimeout(this.seekTimer);
    this.finishSeek?.();
    const generation = this.generation;
    return new Promise<void>((resolve, reject) => {
      this.finishSeek = resolve;
      this.seekTimer = setTimeout(() => {
        this.finishSeek = undefined;
        if (generation !== this.generation) {
          resolve();
          return;
        }
        const operation =
          this.current?.source === "youtube"
            ? Audio.seekTo({ positionMs: position * 1000 })
            : Auth.spotifyRequest({
                path:
                  "/me/player/seek?position_ms=" + Math.round(position * 1000),
                method: "PUT",
              });
        void operation.then(() => resolve(), reject);
      }, 80);
    });
  }
  async setMode(mode: MixMode) {
    this.update({ mode });
    if (isNative) await Audio.setAutoMixMode({ mode });
    await db.settings.put({ key: "mixMode", value: mode });
  }
  async mixNow() {
    if (!this.nextTrack) return;
    if (this.state.mode === "off" || this.current?.source !== "youtube" ||
        this.nextTrack.source !== "youtube" || !isNative) {
      await this.next();
      return;
    }
    await Audio.triggerManualMix();
  }
  private async pollSpotify() {
    if (this.polling || this.ignoreNative || this.state.error) return;
    this.polling = true;
    const generation = this.generation;
    try {
      const { data } = await Auth.spotifyRequest({ path: "/me/player" });
      if (generation !== this.generation || this.ignoreNative || this.state.error || !data?.item)
        return;
      if (this.current?.spotifyUri !== data.item.uri) return;
      this.update({
        position: (data.progress_ms || 0) / 1000,
        deviceName: data.device?.name || this.state.deviceName,
        playing: data.is_playing,
        ...(typeof data.loading === "boolean"
          ? { loading: data.loading }
          : data.is_playing
            ? { loading: false }
            : {}),
      });
      if (
        this.current &&
        this.current.duration > 0 &&
        data.is_playing && this.current.duration - this.state.position <= 2 &&
        this.spotifyTransport !== "integrated" &&
        this.nextTrack
      )
        await this.next(false);
    } catch {
      /* Poll failures must not corrupt queue or invent playback. */
    } finally {
      this.polling = false;
    }
  }
}
export const player = new AudioOrchestrator();
