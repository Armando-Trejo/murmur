import { MotionGlyph } from "./components/MotionGlyph";
import { motionMs, release, settle, settleCss, songStep } from "./core/motion";
import { HomeFeed } from "./components/HomeFeed";
import { importCollectionLink, readCollectionLink, saveCollection } from "./core/CollectionImport";
import { MusicDirectory } from "./components/MusicDirectory";
import { CollectionLinkImport } from "./components/CollectionLinkImport";
import { MarqueeTitle } from "./components/MarqueeTitle";
import { PlayerLayer, type PlayerRiseHandle } from "./components/PlayerLayer";
import { MiniTrackSwap } from "./components/MiniTrackSwap";
import { Unfold } from "./components/Unfold";
import { navTransitionRunning } from "./core/viewTransition";
import { restoreUpcoming, settleReorder, withoutUpcoming } from "./core/gestures";
import { useMiniRise } from "./components/useMiniRise";
import { CoverDoubleTap } from "./components/CoverDoubleTap";
import { QueueRemoveReveal, useQueueRowGestures } from "./components/QueueRowGestures";
import { MiniProgress, SeekBar } from "./components/SeekBar";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useMemo,
} from "react";
import {
  AnimatePresence,
  motion,
  Reorder,
  useReducedMotion,
  useDragControls,
  type MotionStyle,
} from "framer-motion";
import {
  Home,
  Search,
  Library,
  Link2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Plus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Mic,
  Download,
  Upload,
  Shuffle,
  AudioLines,
  ListMusic,
  X,
  Heart,
  Radio,
  ArrowUpRight,
  Headphones,
  Moon,
  RefreshCw,
  WifiOff,
  GripVertical,
  Music2,
  Disc3,
  Car,
  Volume2,
  LogOut,
  ShieldCheck,
  ArrowUp,
  ArrowDown,
  Image as ImageIcon,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { App as CapacitorApp } from "@capacitor/app";
import type { QueueItem, Playlist, MixMode } from "./core/types";
import {
  db,
  saveTrack,
  addToPlaylist,
  playlistTracks,
  exportBackup,
  importBackup,
} from "./core/db";
import { player } from "./core/AudioOrchestrator";
import {
  generateMix,
  getLyrics,
  geniusLyricsUrl,
  searchAll,
  spotifyTrack,
  validateArtist,
  type LyricsResult,
} from "./core/DiscoveryEngine";
import { parseFanUpload } from "./core/FanUploadParser";
import { routeVoiceCommand, updateVoiceHints } from "./core/VoiceCommandRouter";
import { MurmurMark } from "./components/MurmurMark";
import { Audio, Auth, Voice, isNative, type ConnectionStatus } from "./native";
import {
  ConnectionsPanel,
  type NoticeKind,
} from "./components/ConnectionsPanel";
import { resolveView } from "./core/navigation";
import { useInterfaceNavigation } from "./core/useInterfaceNavigation";
import { SwipeSurface } from "./components/SwipeSurface";
import {
  AppearanceSettings,
  useAppearance,
} from "./components/AppearanceSettings";
import { artworkFor } from "./core/artwork";
import { Cover } from "./components/Cover";
import { ArtistProfile } from "./components/ArtistProfile";
import { OverflowMenu, type MenuEntry } from "./components/OverflowMenu";
import { ListPlus, Sparkles, Link as LinkIcon, ArrowDownUp } from "lucide-react";
import { orderMusic, listeningStats, type MusicOrder } from "./core/musicOrder";
import { PlayerBackdrop, useArtworkTone } from "./components/PlayerBackdrop";
import { SyncedLyrics } from "./components/SyncedLyrics";
import { ListeningInsights } from "./components/ListeningInsights";
import { PlaybackDiagnostics } from "./components/PlaybackDiagnostics";
import { formatListening, greeting, listenedSeconds } from "./core/insights";
import { haptic, hapticsEnabled, setHapticsEnabled } from "./core/haptics";
import { prefetchAudio } from "./core/prefetch";
import { albumLink, SPOTIFY_ALBUM_PREFIX, type AlbumResult } from "./core/albumSearch";
import { AlbumResults } from "./components/AlbumResults";
import { MadeForYou } from "./components/MadeForYou";
import { DAILY_ID } from "./core/autoMixes";
import { magicPicks } from "./core/magicShuffle";
import { useFitCover } from "./core/useFitCover";
import { normalize } from "./core/FanUploadParser";
import { CoverEditor } from "./components/CoverEditor";
import { uniqueSongs } from "./core/dedupe";
import { SmartDownloadsSetting } from "./components/SmartDownloadsSetting";
import { runSmartDownloads } from "./core/smartDownloads";
import type { CustomArtwork } from "./core/types";
import { useHeaderScroll } from "./core/useHeaderScroll";
import { WakeWordSetting } from "./components/WakeWordSetting";
import { VoiceExtrasSetting } from "./components/VoiceExtrasSetting";
import { MomentMix } from "./components/MomentMix";
import { VoiceChoices } from "./components/VoiceChoices";
import type { MomentMixResult } from "./core/momentMix";
import { heardLabel, spokenReply } from "./core/voiceReplies";
import { checkForUpdate, dismissUpdate } from "./core/updates";
import { Welcome, needsWelcome } from "./components/Welcome";
import {
  loadRecentSearches,
  pushRecent,
  removeRecent,
  saveRecentSearches,
} from "./core/recentSearches";
import { APP_VERSION } from "./config";
import { BarChart3, Clock3, History, Vibrate } from "lucide-react";
import {
  LibraryResults,
  LibrarySearchBox,
  LibraryToolbar,
  SortChip,
  albumPlaylist,
  songsLabel,
  useDebouncedValue,
  useListening,
  useOpenedPlaylists,
  useSortPreference,
} from "./components/LibraryTools";
import {
  PLAYLIST_SORTS,
  SONG_SORTS,
  addedRanks,
  albumIndexer,
  artistIndexer,
  collectAlbums,
  collectArtists,
  filterItems,
  likedPositions,
  playlistIndexer,
  searchLibrary,
  songIndexer,
  sortPlaylists,
  sortSongs,
} from "./core/librarySearch";

type SleepState =
  | { mode: "off" }
  | { mode: "minutes"; minutes: number; endsAt: number }
  | { mode: "track" };
const sleepChoices = [15, 30, 45, 60] as const;

function SleepCountdown({ sleep, onExpire }: { sleep: SleepState; onExpire: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (sleep.mode !== "minutes") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sleep]);
  useEffect(() => {
    if (sleep.mode === "minutes" && now >= sleep.endsAt) onExpire();
  }, [now, sleep]);
  if (sleep.mode === "off") return <>Temporizador</>;
  if (sleep.mode === "track") return <>Al terminar</>;
  const left = Math.max(0, Math.ceil((sleep.endsAt - now) / 1000));
  return <>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</>;
}

const tabs = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "search", label: "Buscar", icon: Search },
  { id: "library", label: "Tu Biblioteca", icon: Library },
  { id: "connections", label: "Conexiones", icon: Link2 },
];
const mixNames = {
  daily: "Daily Hybrid Mix",
  bridge: "Puente Spotify → YouTube",
  radar: "Radar de descubrimiento",
};
const modes: { value: MixMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "smooth", label: "Suave 5s" },
  { value: "dj", label: "DJ 10s" },
];
const time = (n: number) =>
  !Number.isFinite(n) || n < 0
    ? "—:—"
    : `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
/** Most frequent main artist of a collection, for album headers that lack one. */
function mainArtist(items: QueueItem[]) {
  const votes = new Map<string, number>();
  for (const item of items) {
    const name = item.artist.split(/\s*(?:,|&)\s*/)[0]?.trim();
    if (name && !/^artista (?:por identificar|no identificad[oa])$/i.test(name))
      votes.set(name, (votes.get(name) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
}
function totalLength(items: QueueItem[]) {
  const seconds = items.reduce((sum, item) => sum + (item.duration > 0 ? item.duration : 0), 0);
  if (seconds < 60) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}
function Badge({ source }: { source: string }) {
  return (
    <span
      title={
        source === "spotify"
          ? "La calidad depende del motor seleccionado y del proveedor"
          : source === "youtube"
            ? "El códec real depende del stream disponible"
            : "Playlist local híbrida"
      }
      className={`badge ${source}`}
    >
      {source === "spotify"
        ? "SPOTIFY"
        : source === "youtube"
          ? "YT AUDIO"
          : "MIX"}
    </span>
  );
}
function Equalizer() {
  return (
    <span className="equalizer" aria-label="Reproduciendo">
      <i />
      <i />
      <i />
    </span>
  );
}

export default function App() {
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const current = state.queue[state.index];
  // The engine's real length wins over the catalogue's (a YouTube twin of a Spotify song differs).
  const length = state.duration > 0 ? state.duration : current?.duration > 0 ? current.duration : 0;
  const currentArtwork = artworkFor(current);
  const tone = useArtworkTone(currentArtwork);
  const nav = useInterfaceNavigation();
  const tab = nav.route.view;
  const appearance = useAppearance();
  const [homeFilter, setHomeFilter] = useState("Todo");
  const [libraryFilter, setLibraryFilter] = useState("Canciones");
  const filter = tab === "home" ? homeFilter : libraryFilter;
  const setFilter = tab === "home" ? setHomeFilter : setLibraryFilter;
  const setTab = (value: string) => {
    const next = resolveView(value);
    if (next.view === "home") setHomeFilter("Todo");
    nav.push({ view: next.view });
  };
  const expanded = !!nav.route.player;
  const setExpanded = (value: boolean) =>
    value ? nav.patch({ player: true }) : nav.close("player");
  const [toast, setToast] = useState("");
  const [toastKind, setToastKind] = useState<NoticeKind>("info");
  const [welcome, setWelcome] = useState(needsWelcome);
  /** Optional button on the notice (e.g. "Enviar" for a crash report). */
  const [toastAction, setToastAction] = useState<{ label: string; run: () => void }>();
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [provider, setProvider] = useState("all");
  const [results, setResults] = useState<QueueItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [playlistItems, setPlaylistItems] = useState<QueueItem[]>([]);
  const actionTrack =
    nav.route.sheet?.kind === "actions" ? nav.route.sheet.track : undefined;
  const playlistPicker =
    nav.route.sheet?.kind === "picker"
      ? nav.route.sheet.track
      : nav.route.sheet?.kind === "create"
        ? nav.route.sheet.parentTrack
        : undefined;
  const shared =
    nav.route.sheet?.kind === "shared" ? nav.route.sheet.track : undefined;
  const newPlaylist = nav.route.sheet?.kind === "create";
  const sleepSheet = nav.route.sheet?.kind === "sleep";
  const setActionTrack = (track?: QueueItem) =>
    track ? nav.sheet("actions", track) : nav.close("sheet", "actions");
  const setPlaylistPicker = (track?: QueueItem) =>
    track ? nav.sheet("picker", track) : nav.close("sheet", "picker");
  const setShared = (track?: QueueItem) =>
    track ? nav.sheet("shared", track) : nav.close("sheet", "shared");
  const setNewPlaylist = (value: boolean) =>
    value ? nav.sheet("create") : nav.close("sheet", "create");
  const queueVisible = nav.route.panel === "queue";
  const lyricsOpen = nav.route.panel === "lyrics";
  const setQueueVisible = (value: boolean) =>
    value ? nav.patch({ player: true, panel: "queue" }) : nav.close("panel");
  const setLyricsOpen = (value: boolean) =>
    value ? nav.patch({ player: true, panel: "lyrics" }) : nav.close("panel");
  const [searchOrder, setSearchOrder] = useState<MusicOrder>("relevance");
  const [libraryOrder, setLibraryOrder] = useState<MusicOrder>("listening");

  const [playlistName, setPlaylistName] = useState("");

  const [lyricLookup, setLyricLookup] = useState<{
    key: string; result?: LyricsResult; failed?: boolean;
  }>();
  const [lyricsRetry, setLyricsRetry] = useState(0);
  const lyricKey = current ? JSON.stringify([current.queueId || current.id, current.title,
    current.artist, current.duration]) : "";
  const lyricsState = lyricLookup?.key === lyricKey ? lyricLookup : undefined;
  const lyrics = lyricsState?.result?.timed ?? [];

  const [status, setStatus] = useState<ConnectionStatus>({
    spotify: false,
    youtube: false,
    oauth: false,
  });
  const [busy, setBusy] = useState("");
  const [online, setOnline] = useState(navigator.onLine);

  const [voiceBusy, setVoiceBusy] = useState(false);
  const [wakeListening, setWakeListening] = useState(false);
  /** What MURMUR is doing with a voice request after hearing it ("Buscando «…»", "Preparando música…"). */
  const [voiceThinking, setVoiceThinking] = useState("");
  const voicePreparing = useRef(false);
  useEffect(() => {
    if (!voiceThinking) return;
    const t = setTimeout(() => { voicePreparing.current = false; setVoiceThinking(""); }, 25000);
    return () => clearTimeout(t);
  }, [voiceThinking]);
  // "Preparando música…" stays until the song actually sounds (or fails).
  useEffect(() => {
    if (!voicePreparing.current) return;
    if ((!state.loading && state.playing) || state.error) { voicePreparing.current = false; setVoiceThinking(""); }
  }, [state.loading, state.playing, state.error]);
  // Safety net: the native side always ends the capture within 14 s; never leave the pill stuck.
  useEffect(() => {
    if (!wakeListening) return;
    const t = setTimeout(() => setWakeListening(false), 16000);
    return () => clearTimeout(t);
  }, [wakeListening]);
  const [sleep, setSleep] = useState<SleepState>({ mode: "off" });
  const [haptics, setHaptics] = useState(hapticsEnabled);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const sheetDrag = useDragControls();
  /** The open sheet was thrown down by the finger (its exit keeps going down instead of a short drop). */
  const sheetThrown = useRef(false);
  const sheetOpen = !!(actionTrack || playlistPicker || newPlaylist || shared || sleepSheet);
  useEffect(() => {
    if (sheetOpen) sheetThrown.current = false;
  }, [sheetOpen]);
  const allTracks = useLiveQuery(() => db.tracks.toArray(), [], []);
  const weekSeconds = useLiveQuery(async () => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);
    const entries = await db.history.where("at").aboveOrEqual(since.getTime()).toArray();
    const known = new Map((await db.tracks.bulkGet([...new Set(entries.map(e => e.trackId))]))
      .flatMap(track => (track ? [[track.id, track] as const] : [])));
    return entries.reduce((sum, entry) => sum + listenedSeconds(entry, known.get(entry.trackId)), 0);
  }, [], 0);
  const stats = useLiveQuery(
    async () => listeningStats(await db.history.toArray()),
    [],
    {},
  );
  // The library shows each song once even when it is saved on Spotify and on YouTube.
  const tracks = useMemo(
    () =>
      uniqueSongs(
        orderMusic(
          allTracks.filter((t) => t.saved !== false),
          libraryOrder,
          stats,
        ),
        stats,
      ).songs,
    [allTracks, libraryOrder, stats],
  );
  const trackLookup = useMemo(
    () => new Map(allTracks.map((track) => [track.id, track])),
    [allTracks],
  );
  const storedPlaylists = useLiveQuery(() => db.playlists.toArray(), [], []);
  const playlists = useMemo(
    () =>
      storedPlaylists.map((playlist) => {
        let artwork = artworkFor(playlist);
        if (!artwork)
          for (const id of playlist.trackIds) {
            artwork = artworkFor(trackLookup.get(id));
            if (artwork) break;
          }
        return { ...playlist, artworkUrl: artwork };
      }),
    [storedPlaylists, trackLookup],
  );
  const [visibleSongs, setVisibleSongs] = useState(80);
  useEffect(
    () => setVisibleSongs(80),
    [tab, filter, libraryOrder, nav.route.playlistId],
  );
  const [feedCollection, setFeedCollection] = useState<{
    link: string;
    revision?: number;
    data?: Awaited<ReturnType<typeof readCollectionLink>>;
    error?: string;
  }>();
  const [collectionRetry, setCollectionRetry] = useState(0);
  const feedId = /^feed:([A-Za-z0-9_-]{2,120})$/.exec(nav.route.playlistId ?? "")?.[1];
  const feedLink = feedId
    ? feedId.startsWith(SPOTIFY_ALBUM_PREFIX) || feedId.startsWith("MPREb")
      ? albumLink(feedId)
      : "https://music.youtube.com/playlist?list=" + feedId
    : undefined;
  const collection = feedCollection && feedCollection.link === feedLink &&
    feedCollection.revision === status.youtubeRevision ? feedCollection : undefined;
  const activePlaylist = collection?.data?.playlist ?? playlists.find((p) => p.id === nav.route.playlistId);
  const displayedPlaylistItems = feedLink ? collection?.data?.items ?? [] : playlistItems;

  useEffect(() => {
    if (!feedLink) return;
    let live = true;
    const revision = status.youtubeRevision;
    setFeedCollection({ link: feedLink, revision });
    void readCollectionLink(feedLink, true).then(data => {
      if (live) setFeedCollection({ link: feedLink, revision, data });
    }).catch((error: unknown) => {
      if (live) setFeedCollection({
        link: feedLink, revision, error: error instanceof Error ? error.message : "No se pudo abrir esta colección.",
      });
    });
    return () => { live = false; };
  }, [feedLink, collectionRetry, status.youtubeRevision]);
  const setActivePlaylist = (playlist?: Playlist) =>
    playlist
      ? nav.push({ view: "library", playlistId: playlist.id })
      : nav.close("playlistId");
  useEffect(() => {
    let live = true;
    setPlaylistItems([]);
    if (activePlaylist && !feedLink)
      void playlistTracks(activePlaylist)
        .then((items) => {
          if (live) setPlaylistItems(items);
        })
        .catch(() => {
          if (live)
            notify(
              "No se pudo abrir esta playlist. Vuelve a intentarlo.",
              "error",
            );
        });
    return () => {
      live = false;
    };
  }, [activePlaylist?.id, activePlaylist?.trackIds.join("|"), feedLink]);
  const history = useLiveQuery(
    () => db.history.orderBy("at").reverse().limit(8).toArray(),
    [],
    [],
  );
  const inputFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shell = document.querySelector(".bottom-shell");
    if (!shell) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--bottom-shell-height",
        Math.ceil(shell.getBoundingClientRect().height) + "px",
      );
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    update();
    return () => observer.disconnect();
  }, []);
  const seq = useRef(0);
  // Which way the cover moves on a song change: back only for Anterior, forward for everything else
  // (a tap on a later song in the queue trims the queue, which must not read as going back).
  const currentKey = current ? current.queueId || current.id : "";
  const lastCoverKey = useRef("");
  const lastCoverDirection = useRef(1);
  if (currentKey !== lastCoverKey.current) {
    if (lastCoverKey.current && currentKey)
      lastCoverDirection.current = songStep(state.queue, state.index, lastCoverKey.current);
    lastCoverKey.current = currentKey;
  }
  const coverDirection = lastCoverDirection.current;
  /** When a finger last threw the mini player's song out (it then leaves with that momentum). */
  const miniFlungAt = useRef(-Infinity);
  /** Swipe up on the mini player: the player rises with the finger (PlayerLayer) and opens past a point. */
  const playerRise = useRef<PlayerRiseHandle>(null);
  const miniRise = useMiniRise(playerRise, () => setExpanded(true));
  useFitCover(expanded, current?.queueId ?? current?.id ?? "");
  useHeaderScroll();
  // Smart downloads: on start, every hour and when the connection returns (Wi-Fi only, inside).
  useEffect(() => {
    if (!isNative) return;
    const run = () => void runSmartDownloads().catch(() => {});
    const first = setTimeout(run, 20_000);
    const hourly = setInterval(run, 3_600_000);
    window.addEventListener("online", run);
    return () => { clearTimeout(first); clearInterval(hourly); window.removeEventListener("online", run); };
  }, []);
  const reduced = useReducedMotion();
  const modalRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const priorView = useRef<string>();
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const detail = !!(nav.route.playlistId || nav.route.artist || nav.route.directory);
    const previous = priorView.current;
    priorView.current = tab;
    // A View Transition is already moving the pages; this slide is only the fallback.
    if (!previous || navTransitionRunning()) return;
    const direction = previous === tab
      ? detail ? 1 : -1
      : Math.sign(tabs.findIndex(item => item.id === tab) - tabs.findIndex(item => item.id === previous));
    const animation = view.animate(
      reduced
        ? [{ opacity: 0.72 }, { opacity: 1 }]
        : [{ opacity: 0.6, transform: `translateX(${direction * 9}px)` }, { opacity: 1, transform: "none" }],
      { duration: reduced ? motionMs.reduced : motionMs.route, easing: settleCss },
    );
    return () => animation.cancel();
  }, [tab, nav.route.playlistId, nav.route.artist, nav.route.directory, reduced]);
  useEffect(() => {
    // Ink ripple from the touch point on list rows and menu items.
    const ripple = (event: PointerEvent) => {
      if (reduced || !event.isPrimary) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        ".song-main,.playlist-row,.sheet-action,.overflow-item,.quick-item,.recent-query,.library-links button,.directory-song,.queue-track,.setting-button",
      );
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--rx", event.clientX - rect.left + "px");
      target.style.setProperty("--ry", event.clientY - rect.top + "px");
      target.classList.remove("tap-ripple");
      void target.offsetWidth;
      target.classList.add("tap-ripple");
      window.setTimeout(() => target.classList.remove("tap-ripple"), 600);
    };
    document.addEventListener("pointerdown", ripple, { passive: true });
    return () => document.removeEventListener("pointerdown", ripple);
  }, [reduced]);
  const notify = (message: string, kind: NoticeKind = "info", action?: { label: string; run: () => void }) => {
    setToastKind(kind);
    setToastAction(action ? () => action : undefined);
    setToast(message);
  };
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notify(
        (e as Error).message ||
          "No se pudo completar la operación. Intenta nuevamente.",
        "error",
      );
    }
  };
  const refreshStatus = async () => {
    if (isNative) setStatus(await Auth.status());
  };
  useEffect(() => {
    if (state.error) notify(state.error, "error");
  }, [state.error]);
  useEffect(() => {
    if (nav.invalid) notify("Esa vista no existe. Te llevamos a Inicio.");
  }, [nav.invalid]);
  const runMix = async (kind: "daily" | "bridge" | "radar") => {
    const id = "local:mix:" + kind;
    const title = kind === "daily" ? "Daily Hybrid Mix" : kind === "bridge" ? "Puente Spotify → YouTube" : "Radar de descubrimiento";
    setBusy(kind);
    nav.push({ view: "library", playlistId: id });
    if (!await db.playlists.get(id)) await db.playlists.put({id,title,source:"hybrid",trackIds:[]});
    try {
      const mix = await generateMix(kind, false);
      if (!mix.length) {
        notify(
          "Guarda canciones o sincroniza Spotify para crear tu primer mix.",
        );
        return;
      }
      await db.transaction("rw", db.tracks, db.playlists, async () => {
        for (const track of mix) {
          const stored = await db.tracks.get(track.id);
          await db.tracks.put({ ...track, saved: stored?.saved ?? false });
        }
        await db.playlists.put({
          id,
          title:
            kind === "daily"
              ? "Daily Hybrid Mix"
              : kind === "bridge"
                ? "Puente Spotify → YouTube"
                : "Radar de descubrimiento",
          source: "hybrid",
          trackIds: mix.map((t) => t.id),
        });
      });
      // Enrich the preview without blocking the tap or changing the playing queue.
      void generateMix(kind).then(async enriched => {
        if (!enriched.length) return;
        await db.transaction("rw", db.tracks, db.playlists, async () => {
          for (const track of enriched) {
            const stored=await db.tracks.get(track.id);
            await db.tracks.put({...track,saved:stored?.saved??false});
          }
          await db.playlists.update(id,{trackIds:enriched.map(t=>t.id)});
        });
      }).catch(()=>{});
    } finally {
      setBusy("");
    }
  };
  const save = async (track: QueueItem) => {
    await saveTrack(track);
    notify("Canción guardada en tu biblioteca local.", "success");
    if (track.source === "spotify" && status.spotify) {
      try {
        await Auth.spotifyRequest({
          path:
            "/me/library?uris=" + encodeURIComponent(track.spotifyUri || ""),
          method: "PUT",
        });
        notify("Canción guardada en tu biblioteca y en Spotify.", "success");
      } catch (e) {
        notify("Guardada localmente. Spotify: " + (e as Error).message);
      }
    }
  };
  /**
   * A queue row swiped away. Never the song playing (false: the row springs back); "Deshacer" puts it
   * back where it was, or right after the current song if its neighbour has played meanwhile.
   */
  const removeFromQueue = (track: QueueItem) => {
    const live = player.getSnapshot();
    const removal = track.queueId ? withoutUpcoming(live.queue, live.index, track.queueId) : null;
    if (!removal) return false;
    player.reorder(removal.queue);
    haptic("confirm");
    notify("Quitada de la cola", "info", {
      label: "Deshacer",
      run: () => {
        const now = player.getSnapshot();
        const back = restoreUpcoming(now.queue, now.index, removal.item, removal.after);
        if (back) player.reorder(back);
      },
    });
    return true;
  };
  const storeRecent = (next: string[]) => {
    setRecentSearches(next);
    void saveRecentSearches(next).catch(() => {});
  };
  const rememberSearch = (value: string) => {
    const next = pushRecent(recentSearches, value);
    if (next !== recentSearches) storeRecent(next);
  };
  const forgetSearch = (value?: string) =>
    storeRecent(value === undefined ? [] : removeRecent(recentSearches, value));
  const chooseSleep = (choice: number | "track") =>
    guard(async () => {
      if (!isNative) throw new Error("El temporizador funciona en Android.");
      const minutes = choice === "track" ? -2 : choice;
      await Audio.setSleepTimer({ minutes });
      setSleep(
        choice === "track"
          ? { mode: "track" }
          : minutes > 0
            ? { mode: "minutes", minutes, endsAt: Date.now() + minutes * 60_000 }
            : { mode: "off" },
      );
      haptic("confirm");
      const external =
        minutes !== 0 &&
        current?.source === "spotify" &&
        !state.deviceName.includes("MURMUR");
      notify(
        external
          ? "Temporizador activo para MURMUR. Spotify Connect sigue en su dispositivo: detenlo allí si hace falta."
          : choice === "track"
            ? "Se detendrá al terminar la canción."
            : minutes
              ? `Se detendrá en ${minutes} minutos.`
              : "Temporizador desactivado.",
      );
    });
  const startSearch = (value: string, source = "all") => {
    setQuery(value);
    setProvider(source);
    setTab("search");
  };
  const openPlaylist = async (playlist: Playlist) => {
    nav.push({ view: "library", playlistId: playlist.id });
  };
  const openTrackAlbum = async (track:QueueItem) => {
    let p:Playlist|undefined=playlists.find(p=>p.kind==="album"&&p.trackIds.includes(track.id));
    if(!p&&track.source==="spotify"&&track.albumId)p=await importCollectionLink("https://open.spotify.com/album/"+track.albumId);
    if(!p&&track.album){const items=allTracks.filter(t=>t.album===track.album&&t.artist===track.artist);p={id:"local:album:"+encodeURIComponent(track.artist+"/"+track.album),title:track.album,kind:"album",source:track.source,trackIds:items.map(t=>t.id),artworkUrl:track.artworkUrl};await db.playlists.put(p)}
    if(!p)throw new Error("Esta canción no tiene datos de álbum. Puedes etiquetar su colección como Álbum.");
    nav.push({view:"library",playlistId:p.id});
  };
  // «Apaga la música en 20 minutos»: the voice router asks; the same handler as the moon button runs it.
  const latestSleep = useRef(chooseSleep);
  latestSleep.current = chooseSleep;
  useEffect(() => {
    const onSleep = (event: Event) => {
      const choice = (event as CustomEvent<number | "track">).detail;
      void latestSleep.current(choice);
    };
    window.addEventListener("murmur:sleep", onSleep);
    return () => window.removeEventListener("murmur:sleep", onSleep);
  }, []);
  // A newer MURMUR on GitHub: offered once per version, a while after opening (never on the first screen).
  useEffect(() => {
    if (!isNative) return;
    const t = setTimeout(() => void checkForUpdate().then((release) => {
      if (!release) return;
      notify(`Hay una versión nueva de MURMUR (${release.version}).`, "info", {
        label: "Actualizar",
        run: () => { dismissUpdate(release.version); void Audio.openUpdate({ url: release.url }).catch((e) => notify((e as Error).message, "error")); },
      });
    }), 25000);
    return () => clearTimeout(t);
  }, []);
  const [momentBusy, setMomentBusy] = useState(false);
  /** The personal mix (your songs at this hour + close discoveries), built ahead so the tap is instant. */
  const playMomentMix = (tracks: QueueItem[], mix: MomentMixResult) =>
    guard(async () => { await player.playList(tracks); notify(mix.reason); });
  const playMoment = (request: string) => {
    if (momentBusy) return;
    setMomentBusy(true);
    void guard(() => voiceCommand(request, undefined, true)).finally(() => setMomentBusy(false));
  };
  const voiceCommand = async (text: string, source?: string, quiet = false) => {
    let answer: string;
    // Heard: say so (a light tap) and show what is being looked for until there is an answer.
    if (!quiet) {
      voicePreparing.current = false;
      setVoiceThinking(`Buscando «${heardLabel(text)}»…`);
      haptic();
    }
    try {
      answer = await routeVoiceCommand(text, save);
    } catch (error) {
      if (!quiet) setVoiceThinking("");
      // Hands-free: what went wrong is also said out loud.
      const reply = source === "wake" ? spokenReply((error as Error).message) : undefined;
      if (reply) void Audio.speak({ text: reply }).catch(() => {});
      throw error;
    }
    if (!quiet) {
      const loading = answer.startsWith("Preparando") && player.getSnapshot().loading;
      voicePreparing.current = loading;
      setVoiceThinking(loading ? "Preparando música…" : "");
      // The status at the top already says it; a second notice would repeat it.
      if (loading) answer = "";
    }
    if (answer) notify(answer);
    // After «Ok MURMUR» the phone may be in a pocket: answer out loud (unless the music already does).
    const reply = source === "wake" ? spokenReply(answer) : undefined;
    if (reply && isNative) void Audio.speak({ text: reply }).catch(() => {});
  };
  const listen = async () => {
    if (voiceBusy) return;
    if (!isNative) {
      notify("El control por voz está disponible en Android.");
      return;
    }
    setVoiceBusy(true);
    try {
      const { text } = await Voice.listen();
      await voiceCommand(text);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setVoiceBusy(false);
    }
  };

  useEffect(() => {
    void guard(async () => {
      await player.init();
      await refreshStatus();
    });
    void loadRecentSearches().then(setRecentSearches).catch(() => {});
    // A few seconds after start, so it never competes with the first screen.
    const hints = setTimeout(() => void updateVoiceHints().catch(() => {}), 8000);
    // MURMUR closed unexpectedly last time: offer to share what happened (the person chooses where).
    if (isNative)
      void Voice.lastCrash().then(({ report, version }) => {
        if (!report) return;
        const recent = localStorage.getItem("murmur.jsErrors") || "";
        notify("MURMUR se cerró inesperadamente la última vez. ¿Envías el reporte para corregirlo?", "error", {
          label: "Enviar",
          run: () => void Voice.shareText({ title: "Reporte de MURMUR " + version, text: report + (recent ? "\n\nErrores recientes:\n" + recent : "") }).catch(() => {}),
        });
      }).catch(() => {});
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      clearTimeout(hints);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(
      () => setToast(""),
      toastAction ? 15000 : toastKind === "error" ? 10000 : 6500,
    );
    return () => clearTimeout(t);
  }, [toast]);
  const latestNative = useRef({
    nav,
    tab,
    setTab,
    setExpanded,
    setShared,
    voiceCommand,
    runMix,
  });
  latestNative.current = {
    nav,
    tab,
    setTab,
    setExpanded,
    setShared,
    voiceCommand,
    runMix,
  };
  useEffect(() => {
    let cancelled = false;
    const handles: { remove(): Promise<void> }[] = [];
    if (isNative) {
      const add = async (name: string, cb: (event: any) => void) => {
        const h = await Audio.addListener(name, cb);
        if (cancelled) await h.remove();
        else handles.push(h);
      };

      void add("onOpenPlayer", () => {
        latestNative.current.setExpanded(true);
      });
      void add(
        "onVoiceCommandCaptured",
        (e) => void guard(() => latestNative.current.voiceCommand(e.text, e.source)),
      );
      void CapacitorApp.addListener(
        "resume",
        () =>
          void guard(async () => {
            await player.refreshNativeState();
            await refreshStatus();
          }),
      ).then((h) => {
        if (cancelled) void h.remove();
        else handles.push(h);
      });
      void add("onAuthChanged", (e) => {
        void guard(refreshStatus);
        if (e.verified)
          notify(
            "Spotify autorizado. Ya puedes sincronizar tu biblioteca.",
            "success",
          );
      });
      void add("onAuthError", (e) => {
        notify(e.message, "error");
        void guard(refreshStatus);
      });
      void add("onSpotifyEngineAuthorized", () => {
        void guard(refreshStatus);
        notify(
          "Motor Spotify autorizado. Ya puedes probar una canción con Premium.",
          "success",
        );
      });
      void add("onSleepTimerFinished", () => setSleep({ mode: "off" }));
      void add("onVoiceError", (e) => notify(e.message, "error"));
      // "Ok MURMUR" was confirmed and the phone is listening for the request.
      void add("onVoiceListening", (e) => setWakeListening(!!e.listening));
      void add("onPlaybackNotice", (e) => notify(e.message, "error"));
      void add("onShortcutReceived", (e) => {
        if (e.target === "mix")
          latestNative.current.nav.push({ view: "library", playlistId: DAILY_ID });
        else
          latestNative.current.setTab(
            e.target === "search" ? "search" : "library",
          );
      });
      void add(
        "onSharedUrlReceived",
        (e) =>
          void guard(async () => {
            const match = String(e.url).match(/https?:\/\/[^\s]+/);
            if (!match) throw new Error("No se encontró un enlace compatible.");
            const url = new URL(match[0]);
            let track: QueueItem | undefined;
            if (url.hostname === "open.spotify.com") {
              const id = url.pathname.match(/\/track\/([a-zA-Z0-9]{22})/)?.[1];
              if (id)
                track = spotifyTrack(
                  (await Auth.spotifyRequest({ path: "/tracks/" + id })).data,
                );
            } else if (
              url.hostname === "youtu.be" ||
              /(^|\.)youtube\.com$/.test(url.hostname)
            ) {
              const id =
                url.hostname === "youtu.be"
                  ? url.pathname.slice(1)
                  : url.searchParams.get("v") ||
                    url.pathname.match(/\/(?:shorts|live)\/([\w-]+)/)?.[1];
              if (id && /^[\w-]{11}$/.test(id))
                track = (await Audio.getTrackInfo({ videoId: id })).track;
            }
            if (!track)
              throw new Error(
                "Comparte un enlace de canción de Spotify o video de YouTube.",
              );
            latestNative.current.setShared(track);
          }),
      );
      void CapacitorApp.addListener("backButton", () => {
        if (!latestNative.current.nav.back()) {
          if (latestNative.current.tab !== "home")
            latestNative.current.setTab("home");
          else void CapacitorApp.minimizeApp();
        }
      }).then((h) => {
        if (cancelled) void h.remove();
        else handles.push(h);
      });
    }
    return () => {
      cancelled = true;
      handles.forEach((h) => void h.remove());
    };
  }, []);
  useEffect(() => {
    const generation = ++seq.current;
    const value = query.trim();
    // The Álbumes filter fetches on its own (AlbumResults); playlists are filtered locally.
    if (value.length < 2 || provider === "albums") {
      setResults([]);
      setSearchError("");
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void searchAll(value, provider)
        .then((found) => {
          if (generation !== seq.current) return;
          setResults(found);
          setSearchError("");
        })
        .catch((e) => {
          if (generation === seq.current) {
            setResults([]);
            setSearchError(e.message);
          }
        })
        .finally(() => {
          if (generation === seq.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, provider]);
  useEffect(() => {
    if (!lyricsOpen || !current) return;
    const controller = new AbortController();
    let live = true;
    setLyricLookup(undefined);
    const timeout = setTimeout(() => controller.abort(), 8000);
    void getLyrics(current, controller.signal).then(result => {
      if (live) setLyricLookup({ key: lyricKey, result });
    }).catch(() => {
      if (live) setLyricLookup({ key: lyricKey, failed: true });
    }).finally(() => clearTimeout(timeout));
    return () => {
      live = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [lyricsOpen, lyricKey, lyricsRetry]);
  const modalOpen = !!(
    actionTrack ||
    playlistPicker ||
    newPlaylist ||
    shared ||
    sleepSheet ||
    expanded
  );
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.body.style.overflowY = previous;
    };
  }, [modalOpen]);
  useEffect(() => {
    if (!modalOpen) return;
    const before = document.activeElement as HTMLElement;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        nav.back();
      }
      if (event.key === "Tab") {
        const dialogs =
          document.querySelectorAll<HTMLElement>('[role="dialog"]');
        const nodes = dialogs
          .item(dialogs.length - 1)
          ?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,[tabindex="0"]',
          );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const timer = setTimeout(
      () =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
          .at(-1)
          ?.querySelector<HTMLElement>("button,input")
          ?.focus(),
      100,
    );
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", handler);
      before?.focus();
    };
  }, [modalOpen, expanded, actionTrack, playlistPicker, newPlaylist, shared, sleepSheet]);

  async function exportData() {
    const content = await exportBackup();
    if (isNative) {
      const result = await Audio.saveBackup({ content });
      notify(
        result.saved
          ? "Respaldo exportado correctamente."
          : "Exportación cancelada.",
        result.saved ? "success" : "info",
      );
    } else {
      const url = URL.createObjectURL(
        new Blob([content], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "murmur-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Respaldo preparado para descargar.", "success");
    }
  }
  async function download(track: QueueItem) {
    if (!isNative) throw new Error("La descarga de audio requiere Android.");
    if (!track.videoId)
      throw new Error("Spotify gestiona sus descargas en la app oficial.");
    notify("Descargando audio…");
    const { path } = await Audio.downloadOfflineAudio({
      videoId: track.videoId,
      fileName: track.title,
    });
    await saveTrack({ ...track, offlinePath: path });
    notify("Descarga completada. Audio disponible sin conexión.", "success");
  }
  const songRow = (
    track: QueueItem,
    index: number,
    collection: QueueItem[],
    onChoose?: () => void,
    numbered = false,
    /** Search results: play only this song; MURMUR then continues with related music, never with other versions of it. */
    solo = false,
  ) => (
    <SwipeSurface
      className={"song-row" + (current?.id === track.id ? " is-current" : "")}
      key={track.queueId ?? JSON.stringify([track.id, index])}
      positive
      reveal={<><ListPlus size={20} /><span>A la cola</span></>}
      onSwipe={() => {
        player.enqueue(track);
        haptic("confirm");
        notify("Añadida a la cola");
      }}
      onLongPress={() => setActionTrack(track)}
    >
      <button
        className="song-main"
        onPointerDown={() => prefetchAudio([track], 1)}
        onClick={() => {
          onChoose?.();
          void (solo ? player.playList([track]) : player.playList(collection, index));
        }}
      >
        {numbered ? (
          <span className="track-number" aria-hidden="true">{index + 1}</span>
        ) : (
          <Cover track={track} kind={index} size="small" />
        )}
        <span className="song-copy">
          <strong className={current?.id === track.id ? "highlight" : ""}>
            <MarqueeTitle text={track.title} />
          </strong>
          <span>
            <Badge source={track.source} />
            {track.artist}
            {track.offlinePath && <Download size={12} />}
          </span>
        </span>
        {current?.id === track.id && state.playing ? (
          <Equalizer />
        ) : (
          <span className="duration">{time(track.duration)}</span>
        )}
      </button>
      <button
        className="icon-button"
        aria-label={"Opciones de " + track.title}
        onClick={() => setActionTrack(track)}
      >
        <MoreVertical size={20} />
      </button>
    </SwipeSurface>
  );
  const orderedResults = useMemo(() => orderMusic(results, searchOrder, stats), [results, searchOrder, stats]);
  useEffect(() => prefetchAudio(orderedResults.slice(0, 2), 2), [orderedResults]);
  const savedPlaylistIds = useMemo(() => new Set(playlists.map((p) => p.id)), [playlists]);
  // Search inside the open playlist or album (title, artist, album; accents and case ignored).
  const [collectionQuery, setCollectionQuery] = useState("");
  // Cover editor target: a saved playlist/album or a song.
  const [coverTarget, setCoverTarget] = useState<{ kind: "playlist" | "track"; id: string }>();
  const coverItem = useLiveQuery(
    async () => coverTarget ? (coverTarget.kind === "playlist" ? db.playlists.get(coverTarget.id) : db.tracks.get(coverTarget.id)) : undefined,
    [coverTarget?.kind, coverTarget?.id],
  );
  const saveCover = async (change: CustomArtwork) => {
    if (!coverTarget) return;
    const table = coverTarget.kind === "playlist" ? db.playlists : db.tracks;
    await (table as typeof db.tracks).update(coverTarget.id, { customArtwork: change.customArtwork, artworkFrame: change.artworkFrame } as never);
    // The song may be in the queue right now: show the new cover there too.
    if (coverTarget.kind === "track") {
      const live = player.getSnapshot();
      if (live.queue.some((t) => t.id === coverTarget.id))
        player.update({ queue: live.queue.map((t) => t.id === coverTarget.id ? { ...t, ...change } : t) });
    }
  };
  useEffect(() => setCollectionQuery(""), [nav.route.playlistId]);
  const collectionMatches = useMemo(() => {
    const words = normalize(collectionQuery).split(" ").filter(Boolean);
    if (!words.length) return displayedPlaylistItems;
    return displayedPlaylistItems.filter((t) => {
      const text = normalize(`${t.title} ${t.artist} ${t.album ?? ""}`);
      return words.every((w) => text.includes(w));
    });
  }, [collectionQuery, displayedPlaylistItems]);
  // 2.17 «Tu Biblioteca»: one search for everything, plus a search and a remembered order per category.
  const libraryHome = tab === "library" && !nav.route.playlistId && !nav.route.artist && !nav.route.directory;
  const libraryLists = tab === "library" && !nav.route.playlistId && !nav.route.artist && nav.route.directory !== "insights";
  const listening = useListening(libraryLists);
  const openedPlaylists = useOpenedPlaylists(feedId ? undefined : nav.route.playlistId);
  const [songSort, setSongSort] = useSortPreference("songs", SONG_SORTS, "recent");
  const [downloadSort, setDownloadSort] = useSortPreference("downloads", SONG_SORTS, "recent");
  const [playlistSort, setPlaylistSort] = useSortPreference("playlists", PLAYLIST_SORTS, "recent");
  const [libraryQuery, setLibraryQuery] = useState("");
  const librarySearchText = useDebouncedValue(libraryQuery.trim());
  const [categoryQuery, setCategoryQuery] = useState("");
  const categorySearchText = useDebouncedValue(categoryQuery.trim(), 120);
  useEffect(() => setCategoryQuery(""), [libraryFilter]);
  useEffect(() => {
    if (tab !== "library") setLibraryQuery("");
  }, [tab]);
  useEffect(() => setVisibleSongs(80), [songSort, downloadSort, categorySearchText]);
  const likedOrder = useMemo(() => likedPositions(storedPlaylists), [storedPlaylists]);
  const songOrderContext = useMemo(() => ({ stats: listening, liked: likedOrder }), [listening, likedOrder]);
  const addedRank = useMemo(
    () => (libraryLists ? addedRanks(allTracks.filter((t) => t.saved !== false), songOrderContext) : undefined),
    [libraryLists, allTracks, songOrderContext],
  );
  const libraryAlbums = useMemo(() => (libraryLists ? collectAlbums(tracks, playlists) : []), [libraryLists, tracks, playlists]);
  const libraryArtists = useMemo(() => (libraryLists ? collectArtists(tracks) : []), [libraryLists, tracks]);
  const songIndex = useMemo(() => songIndexer(), []);
  const albumIndex = useMemo(() => albumIndexer(), []);
  const artistIndex = useMemo(() => artistIndexer(), []);
  const playlistIndex = useMemo(() => playlistIndexer(), []);
  const librarySongs = useMemo(
    () => (libraryHome ? sortSongs(tracks, songSort, songOrderContext) : []),
    [libraryHome, tracks, songSort, songOrderContext],
  );
  const libraryDownloads = useMemo(
    () =>
      libraryHome && libraryFilter === "Descargas"
        ? sortSongs(tracks.filter((t) => t.offlinePath), downloadSort, songOrderContext)
        : [],
    [libraryHome, libraryFilter, tracks, downloadSort, songOrderContext],
  );
  const categorySongs = libraryFilter === "Descargas" ? libraryDownloads : librarySongs;
  const categorySongMatches = useMemo(
    () => filterItems(songIndex(categorySongs), categorySearchText),
    [songIndex, categorySongs, categorySearchText],
  );
  const categorySongPosition = useMemo(() => new Map(categorySongs.map((t, i) => [t.id, i])), [categorySongs]);
  const librarySongPosition = useMemo(() => new Map(librarySongs.map((t, i) => [t.id, i])), [librarySongs]);
  const libraryPlaylists = useMemo(
    () =>
      libraryHome && libraryFilter === "Playlists"
        ? filterItems(
            playlistIndex(sortPlaylists(playlists, playlistSort, { stats: listening, opened: openedPlaylists })),
            categorySearchText,
          )
        : { items: [], fuzzy: false },
    [libraryHome, libraryFilter, playlistIndex, playlists, playlistSort, listening, openedPlaylists, categorySearchText],
  );
  const libraryResults = useMemo(
    () =>
      libraryHome && librarySearchText
        ? searchLibrary(
            {
              songs: songIndex(tracks),
              albums: albumIndex(libraryAlbums),
              artists: artistIndex(libraryArtists),
              playlists: playlistIndex(playlists.filter((p) => p.kind !== "album")),
            },
            librarySearchText,
            listening,
          )
        : undefined,
    [libraryHome, librarySearchText, songIndex, albumIndex, artistIndex, playlistIndex, tracks, libraryAlbums, libraryArtists, playlists, listening],
  );
  // Playlists without a cover of their own (liked songs, local ones) show their first song's artwork.
  const trackArt = useMemo(() => new Map(allTracks.map((t) => [t.id, t.artworkUrl] as const)), [allTracks]);
  const playlistArt = (p: Playlist) => p.artworkUrl || p.customArtwork ? p : { artworkUrl: p.trackIds.slice(0, 40).map((id) => trackArt.get(id)).find(Boolean) };
  const openAlbum = (album: AlbumResult) => {
    haptic();
    rememberSearch(query);
    nav.push({ view: "library", playlistId: "feed:" + album.feedId });
  };
  useEffect(() => prefetchAudio(displayedPlaylistItems.slice(0, 3)), [displayedPlaylistItems]);
  const musicArt = useMemo(
    () => orderMusic(tracks, "listening", stats).filter((t) => artworkFor(t)),
    [tracks, stats],
  );
  const recent = history
    .flatMap((h) => {
      const t = allTracks.find((t) => t.id === h.trackId);
      return t ? [t] : [];
    })
    .filter(
      (t, i, a) =>
        a.findIndex((x) => x.id === t.id) === i &&
        (filter === "Solo YouTube"
          ? t.source === "youtube"
          : filter === "Música"
            ? t.source === "spotify"
            : true),
    );
  const filtered = tracks.filter((t) =>
    filter === "Solo YouTube"
      ? t.source === "youtube"
      : filter === "Música"
        ? t.source === "spotify"
        : true,
  );
  const detailView = !!(nav.route.playlistId || nav.route.artist || nav.route.directory);
  const todayLabel = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const welcomeTrack = current || recent[0] || tracks[0];
  const welcomeTone = useArtworkTone(artworkFor(welcomeTrack));
  useEffect(() => prefetchAudio([welcomeTrack], 1), [welcomeTrack?.id]);
  const hasDownloads = tracks.some((t) => t.offlinePath);
  const isAlbum = activePlaylist?.kind === "album" || !!feedId?.startsWith("MPREb");
  const collectionArt = activePlaylist
    ? artworkFor(activePlaylist) || artworkFor(displayedPlaylistItems[0])
    : undefined;
  const collectionTone = useArtworkTone(collectionArt);
  const collectionArtist = activePlaylist?.artist || (isAlbum ? mainArtist(displayedPlaylistItems) : undefined);
  const collectionLength = totalLength(displayedPlaylistItems);
  const shufflePlay = async (items: QueueItem[]) => {
    if (!items.length) return;
    haptic();
    const order = [...items];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    await player.playList(order);
    player.update({ shuffled: true });
  };
  const searchMenu: MenuEntry[] = [
    { heading: "Ordenar" },
    ...([["relevance", "Relevancia"], ["popular", "Populares"], ["listening", "Más escuchadas por mí"]] as const)
      .map(([value, label]) => ({ label, checked: searchOrder === value, onSelect: () => setSearchOrder(value) })),
    ...(isNative
      ? (["divider", { heading: "Buscar con tu sesión" },
          { label: "Abrir en mi YouTube", icon: <ArrowUpRight size={18} />,
            onSelect: () => void guard(() => Audio.openProviderSearch({ provider: "youtube", query })) },
          { label: "Abrir en Spotify", icon: <ArrowUpRight size={18} />,
            onSelect: () => void guard(() => Audio.openProviderSearch({ provider: "spotify", query })) }] as MenuEntry[])
      : []),
  ];
  const libraryMenu: MenuEntry[] = [
    { label: "Crear playlist híbrida", icon: <Plus size={18} />, onSelect: () => setNewPlaylist(true) },
    { label: "Importar desde un enlace", icon: <LinkIcon size={18} />, hint: "Playlists, mixes y álbumes", onSelect: () => setImportOpen(true) },
  ];
  const setCollectionKind = (kind: "playlist" | "album") => {
    if (!activePlaylist) return;
    void db.playlists.update(activePlaylist.id, { kind })
      .then(() => notify("Etiqueta de colección actualizada", "success"))
      .catch(() => notify("No se pudo cambiar la etiqueta", "error"));
  };
  const collectionMenu: MenuEntry[] = activePlaylist
    ? [
        { label: "Añadir todo a la cola", icon: <ListPlus size={18} />, disabled: !displayedPlaylistItems.length,
          onSelect: () => {
            player.enqueue(displayedPlaylistItems);
            haptic("confirm");
            notify(`${displayedPlaylistItems.length} canciones añadidas a la cola`);
          } },
        ...(!feedLink
          ? ([{ label: "Cambiar carátula", icon: <ImageIcon size={18} />, hint: "Subir, recortar o ajustar",
                onSelect: () => setCoverTarget({ kind: "playlist", id: activePlaylist.id }) },
              "divider", { heading: "Mostrar como" },
              { label: "Playlist", checked: activePlaylist.kind !== "album", onSelect: () => setCollectionKind("playlist") },
              { label: "Álbum", checked: activePlaylist.kind === "album", onSelect: () => setCollectionKind("album") }] as MenuEntry[])
          : []),
      ]
    : [];
  const homeMixKinds: ("daily" | "bridge" | "radar")[] =
    filter === "Solo YouTube"
      ? ["bridge"]
      : filter === "Música"
        ? []
        : ["daily", "bridge", "radar"];
  return (
    <div
      className={`app ${current ? "has-track" : ""} ${expanded ? "player-open" : ""} ${state.carMode ? "car-mode" : ""}`}
    >
      <aside className="desktop-rail">
        <button
          className="brand"
          aria-label="MURMUR · Ir a Inicio"
          onClick={() => setTab("home")}
        >
          <MurmurMark size={32} />
          <span>MURMUR</span>
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "selected" : ""}
            onClick={() => {
              setTab(t.id);
              setActivePlaylist(undefined);
            }}
          >
            <t.icon size={22} />
            {t.label}
          </button>
        ))}
        <div className="rail-foot">
          <ShieldCheck size={18} />
          Tu música, en tu teléfono.
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <AnimatePresence initial={false}>
            {detailView && (
              <motion.button
                key="back"
                className="icon-button topbar-back"
                aria-label="Volver"
                initial={{ opacity: 0, x: reduced ? 0 : -10, scale: reduced ? 1 : 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: reduced ? 0 : -8, transition: { duration: 0.12 } }}
                transition={{ duration: reduced ? 0.1 : 0.24, ease: settle }}
                whileTap={{ scale: 0.88 }}
                onClick={() => {
                  haptic();
                  if (!nav.back()) nav.push({ view: tab });
                }}
              >
                <ChevronLeft size={24} />
              </motion.button>
            )}
          </AnimatePresence>
          <button
            className="wordmark"
            aria-label="MURMUR · Ir a Inicio"
            onClick={() => setTab("home")}
          >
            <MurmurMark size={20} />
            <b>MURMUR</b>
          </button>
          <button
            className={"icon-button " + (voiceBusy ? "highlight" : "")}
            aria-label="Control por voz"
            disabled={voiceBusy}
            aria-busy={voiceBusy}
            onClick={() => void listen()}
          >
            <Mic size={22} />
          </button>
        </header>
        {!online && (
          <div className="offline-note">
            <WifiOff size={16} />
            Sin conexión · Tu biblioteca descargada sigue aquí
          </div>
        )}
        {state.carMode && (
          <div className="offline-note">
            <Car size={18} />
            Modo coche
            <button onClick={() => player.update({ carMode: false })}>
              Salir
            </button>
          </div>
        )}
        <div className="view-content" ref={viewRef}>
        {tab === "home" && (
          <div className="home-shortcuts">
            <motion.section
              className={"welcome-hero" + (welcomeTone ? " toned" : "")}
              style={welcomeTone ? ({ "--tone": welcomeTone } as MotionStyle) : undefined}
              aria-label="Bienvenida"
              initial={{ opacity: 0, y: reduced ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.1 : 0.5, ease: settle }}
            >
              <div className="welcome-aurora" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div className="welcome-grain" aria-hidden="true" />
              <div className="welcome-copy">
                <motion.span className="eyebrow" initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: settle, delay: reduced ? 0 : 0.05 }}>
                  {todayLabel}
                </motion.span>
                <motion.h1 initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: settle, delay: reduced ? 0 : 0.1 }}>
                  {greeting(new Date().getHours())}
                </motion.h1>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, ease: settle, delay: reduced ? 0 : 0.18 }}>
                  {weekSeconds > 0
                    ? <>Esta semana llevas <b>{formatListening(weekSeconds)}</b> de música.</>
                    : "Spotify y YouTube, en una sola frecuencia."}
                </motion.p>
              </div>
              {welcomeTrack && (
                <motion.button
                  className="welcome-now"
                  whileTap={{ scale: 0.97 }}
                  initial={{ opacity: 0, y: reduced ? 0 : 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: settle, delay: reduced ? 0 : 0.22 }}
                  onClick={() => {
                    haptic();
                    if (current) setExpanded(true);
                    else void player.playList(recent.length ? recent : tracks);
                  }}
                >
                  <Cover track={welcomeTrack} />
                  <span className="welcome-now-copy">
                    <small>{current ? (state.playing ? "Sonando ahora" : "En pausa") : "Continúa donde lo dejaste"}</small>
                    <strong><MarqueeTitle text={welcomeTrack.title} /></strong>
                    <span>{welcomeTrack.artist}</span>
                  </span>
                  <span className="welcome-play" aria-hidden="true">
                    {current && state.playing ? <Equalizer /> : <Play size={18} fill="currentColor" />}
                  </span>
                </motion.button>
              )}
            </motion.section>

            <div className="quick-grid">
              {[
                {
                  title: "Guardadas",
                  icon: Heart,
                  action: () => {
                    setTab("library");
                    setLibraryFilter("Canciones");
                  },
                },
                {
                  title: "Playlists",
                  icon: ListMusic,
                  action: () => {
                    setTab("library");
                    setLibraryFilter("Playlists");
                  },
                },
                {
                  title: "Tu resumen",
                  icon: BarChart3,
                  action: () => nav.push({ view: "library", directory: "insights" }),
                },
              ].map((q, index) => (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="quick-item"
                  key={q.title}
                  initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: settle, delay: reduced ? 0 : 0.26 + index * 0.05 }}
                  onClick={() => {
                    haptic();
                    q.action();
                  }}
                >
                  <span className="quick-art">
                    <q.icon size={21} />
                  </span>
                  <strong>{q.title}</strong>
                </motion.button>
              ))}
            </div>
          </div>
        )}
        <div hidden={tab !== "home"} className="home-provider-region">
          {isNative && !status.preview && <MomentMix onPlayMix={playMomentMix} onPlay={playMoment} busy={momentBusy} />}
          <MadeForYou
            enabled={tab === "home" && isNative && !status.preview}
            onOpen={(playlistId) => nav.push({ view: "library", playlistId })}
            notify={notify}
          />
          <HomeFeed
            active={tab === "home"}
            status={status}
            onPlay={(items, index) => void player.playList(items, index)}
            onCollection={item => {
              if (item.artistId) {
                nav.push({ view: "library", artist: item.title, artistId: item.artistId });
              } else if (item.link) {
                nav.push({ view: "library", playlistId: "feed:" + item.id });
              }
            }}
            onConnect={() => setTab("connections")}
            renderArt={item => <Cover track={item.track ?? { artworkUrl: item.artworkUrl }} />}
          />
        </div>
        {tab === "home" && (
          <section className="home-library" aria-label="Música de tu biblioteca">
            <div className="pills">
              {["Todo", "Música", "Solo YouTube", "Mix Híbrido"].map((f) => (
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  key={f}
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={filter === f ? "active" : ""}
                >
                  {filter === f && (
                    <motion.span className="pill-bg" layoutId="activePill" />
                  )}
                  <span>{f}</span>
                </motion.button>
              ))}
            </div>
            <div className="section-heading">
              <h2>{filter === "Música" ? "Guardadas de Spotify" : "Tu biblioteca"}</h2>
            </div>
            <>
              {filter === "Música" &&
                (filtered.length ? (
                  filtered.slice(0, 8).map((t, i, a) => songRow(t, i, a))
                ) : (
                  <div className="empty-inline">
                    <Music2 size={24} />
                    <p>
                      Tu biblioteca de Spotify aparecerá aquí.
                      <br />
                      <span>Conecta tu cuenta e importa tus canciones.</span>
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setTab("connections")}
                    >
                      Conectar
                    </button>
                  </div>
                ))}
            </>
            {filter !== "Música" && filter !== "Mix Híbrido" && (
              <>
                <div className="section-heading">
                  <h2>Guardadas de YouTube</h2>
                  <button
                    aria-label="Buscar rarezas"
                    onClick={() =>
                      startSearch("unreleased live session", "youtube")
                    }
                  >
                    <ArrowUpRight size={20} />
                  </button>
                </div>
                {filtered.filter((t) => t.source === "youtube").length ? (
                  <div className="video-carousel">
                    {filtered
                      .filter((t) => t.source === "youtube")
                      .slice(0, 6)
                      .map((t) => (
                        <button
                          className="video-card"
                          key={t.id}
                          onClick={() => void player.playList([t])}
                        >
                          <div>
                            <Cover track={t} size="small" />
                            <span className="video-time">
                              {time(t.duration)}
                            </span>
                          </div>
                          <strong><MarqueeTitle text={t.title} /></strong>
                          <p>
                            {t.artist} · <Badge source="youtube" />
                          </p>
                        </button>
                      ))}
                  </div>
                ) : (
                  <button
                    className="discovery-banner"
                    onClick={() => startSearch("live session", "youtube")}
                  >
                    <div className="live-art">
                      <Radio size={35} />
                      <span />
                      <span />
                      <span />
                    </div>
                    <div>
                      <span className="small-tag">
                        EN VIVO · DEMOS · BOOTLEGS
                      </span>
                      <h3>
                        Hay otra versión
                        <br />
                        de tu canción favorita.
                      </h3>
                      <p>
                        Encuéntrala en YouTube <ArrowUpRight size={15} />
                      </p>
                    </div>
                  </button>
                )}
              </>
            )}
            {filter === "Mix Híbrido" && (
              <>
                <div className="section-heading">
                  <h2>Tus playlists híbridas</h2>
                </div>
                {playlists.filter((p) => p.source === "hybrid").length ? (
                  playlists
                    .filter((p) => p.source === "hybrid")
                    .map((p) => (
                      <button
                        key={p.id}
                        className="playlist-row"
                        onClick={() => void guard(() => openPlaylist(p))}
                      >
                        <Cover track={playlistArt(p)} size="small" />
                        <span>
                          <strong>{p.title}</strong>
                          <small>{p.trackIds.length} canciones</small>
                        </span>
                        <Badge source="hybrid" />
                      </button>
                    ))
                ) : (
                  <button
                    className="create-playlist"
                    onClick={() => setNewPlaylist(true)}
                  >
                    <Plus />
                    Crear tu primera playlist híbrida
                  </button>
                )}
              </>
            )}
            <div className="section-heading">
              <h2>Volver a escuchar</h2>
              <span className="muted">Historial</span>
            </div>
            {recent.length ? (
              recent.map((t, i) => songRow(t, i, recent))
            ) : (
              <div className="empty-inline">
                <Headphones size={24} />
                <p>
                  Tu próxima canción empieza aquí.
                  <br />
                  <span>Busca algo y crea tu propio recorrido.</span>
                </p>
                <button
                  className="text-button"
                  onClick={() => setTab("search")}
                >
                  Buscar música
                </button>
              </div>
            )}
          </section>
        )}
        {tab === "search" && (
          <div
            className={
              "page search-page " + (searchFocused ? "search-focused" : "")
            }
          >
            <div className="page-title">
              <h1>Encuentra tu frecuencia</h1>
              <p>Una búsqueda. Dos mundos.</p>
            </div>
            <div className="search-field">
              <Search size={22} />
              <input
                aria-label="Buscar canciones, artistas o conciertos"
                placeholder="Canciones, artistas, conciertos…"
                enterKeyHint="search"
                onFocus={() => {
                  setSearchFocused(true);
                  requestAnimationFrame(() =>
                    document
                      .querySelector(".search-field")
                      ?.scrollIntoView({ block: "start", behavior: "instant" }),
                  );
                }}
                onBlur={() => setSearchFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    rememberSearch(query);
                    event.currentTarget.blur();
                  }
                }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Limpiar búsqueda"
                  onClick={() => setQuery("")}
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <div className="pills search-pills">
              {[
                { id: "all", title: "Todo" },
                { id: "albums", title: "Álbumes" },
                { id: "spotify", title: "Canciones · Spotify" },
                { id: "youtube", title: "Videos / Remixes" },
                { id: "playlists", title: "Playlists locales" },
              ].map((p) => (
                <button
                  key={p.id}
                  className={provider === p.id ? "active" : ""}
                  onClick={() => setProvider(p.id)}
                >
                  {p.title}
                </button>
              ))}
            </div>
            {provider === "albums" && query.trim().length >= 2 ? (
              <AlbumResults
                query={query}
                variant="grid"
                savedIds={savedPlaylistIds}
                onOpen={openAlbum}
                notify={notify}
              />
            ) : provider === "playlists" ? (
              playlists
                .filter((p) =>
                  p.title.toLowerCase().includes(query.toLowerCase()),
                )
                .map((p) => (
                  <button
                    className="playlist-row"
                    key={p.id}
                    onClick={() => void guard(() => openPlaylist(p))}
                  >
                    <Cover track={playlistArt(p)} size="small" />
                    <span>
                      <strong>{p.title}</strong>
                      <small>{p.trackIds.length} canciones</small>
                    </span>
                    <Badge source={p.source} />
                  </button>
                ))
            ) : searching ? (
              <div aria-label="Buscando" className="skeleton-list">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div className="skeleton" key={i} />
                ))}
              </div>
            ) : searchError ? (
              <div className="empty-state">
                <WifiOff />
                <h2>No pudimos buscar</h2>
                <p>{searchError}</p>
                <button
                  className="button secondary"
                  onClick={() => setQuery(query + " ")}
                >
                  Reintentar
                </button>
              </div>
            ) : results.length ? (
              <>
                {provider === "all" && (
                  <AlbumResults
                    query={query}
                    variant="strip"
                    savedIds={savedPlaylistIds}
                    onOpen={openAlbum}
                    notify={notify}
                  />
                )}
                <div className="section-heading results-heading">
                  <h2>Resultados</h2>
                  <span className="muted">{results.length}</span>
                  <OverflowMenu
                    label="Opciones de resultados"
                    icon={<ArrowDownUp size={19} />}
                    entries={searchMenu}
                  />
                </div>
                {orderedResults.map((t, i) =>
                  songRow(t, i, orderedResults, () => rememberSearch(query), false, true),
                )}
              </>
            ) : query.trim().length >= 2 ? (
              <div className="empty-state">
                <Search />
                <h2>Sin resultados</h2>
                <p>
                  {isNative
                    ? "Prueba otro título o selecciona una fuente."
                    : "La búsqueda en línea funciona en la app Android. Aquí puedes buscar en tu biblioteca local."}
                </p>
                {isNative && (
                  <button className="text-button" onClick={() => void guard(() => Audio.openProviderSearch({ provider: "youtube", query }))}>
                    Buscar en mi YouTube <ArrowUpRight size={16} />
                  </button>
                )}
              </div>
            ) : (
              <>
                {recentSearches.length > 0 && (
                  <section className="recent-searches" aria-labelledby="recent-heading">
                    <div className="section-heading">
                      <h2 id="recent-heading">Búsquedas recientes</h2>
                      <button className="text-button" onClick={() => forgetSearch()}>
                        Borrar
                      </button>
                    </div>
                    <ul>
                      {recentSearches.map((item) => (
                        <li key={item}>
                          <button
                            className="recent-query"
                            onClick={() => {
                              setQuery(item);
                              rememberSearch(item);
                            }}
                          >
                            <History size={18} aria-hidden="true" />
                            <span>{item}</span>
                          </button>
                          <button
                            className="icon-button"
                            aria-label={"Quitar " + item + " de recientes"}
                            onClick={() => forgetSearch(item)}
                          >
                            <X size={17} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <h2 className="browse-heading">Explora algo distinto</h2>
                <div className="browse-grid">
                  {[
                    {
                      title: "Sesiones en vivo",
                      q: "live session",
                      class: "browse-live",
                      icon: Radio,
                    },
                    {
                      title: "Demos e inéditas",
                      q: "unreleased demo",
                      class: "browse-demo",
                      icon: Disc3,
                    },
                    {
                      title: "Mezclas y remixes",
                      q: "remix",
                      class: "browse-mix",
                      icon: Shuffle,
                    },
                    {
                      title: "Conciertos completos",
                      q: "full concert",
                      class: "browse-concert",
                      icon: AudioLines,
                    },
                  ].map((c) => (
                    <button
                      className={c.class}
                      key={c.title}
                      onClick={() => startSearch(c.q, "youtube")}
                    >
                      <strong>{c.title}</strong>
                      <c.icon size={54} />
                    </button>
                  ))}
                </div>
                <p className="help-copy">
                  Desliza una canción a la derecha para escucharla a
                  continuación.
                </p>
              </>
            )}
          </div>
        )}
        {tab === "library" && (
          <div className="page">
            {!nav.route.playlistId && !nav.route.artist && !nav.route.directory && <>
              <AnimatePresence initial={false}>
                {importOpen && (
                  <motion.div key="import" className="import-panel"
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
                    transition={{ duration: reduced ? 0.1 : 0.26, ease: settle }}>
                    <CollectionLinkImport notify={notify} onClose={() => setImportOpen(false)}
                      onImported={p => { setImportOpen(false); nav.push({ view: "library", playlistId: p.id }); }} />
                  </motion.div>
                )}
              </AnimatePresence>
            </>}
            {nav.route.directory === "insights" && !nav.route.playlistId ? <ListeningInsights
              tracks={allTracks}
              onBack={() => nav.push({ view: "library" })}
              onPlay={(items, index) => void player.playList(items, index)}
              onArtist={artist => nav.push({ view: "library", artist })}
              renderCover={track => <Cover track={track} size="small" />}
            /> : nav.route.artist ? <ArtistProfile
              key={nav.route.artistId || nav.route.artist}
              name={nav.route.artist}
              artistId={nav.route.artistId}
              library={tracks}
              stats={stats}
              onPlay={(items, index) => void player.playList(items, index)}
              onShuffle={items => void shufflePlay(items)}
              onCollection={item => item.link && nav.push({ view: "library", playlistId: "feed:" + item.id })}
              onArtist={(name, id) => nav.push({ view: "library", artist: name, ...(id ? { artistId: id } : {}) })}
              onSearch={value => startSearch(value, "all")}
              renderSong={(track, index, list) => songRow(track, index, list)}
            /> : nav.route.directory ? <MusicDirectory artist={undefined} mode={nav.route.directory === "insights" ? undefined : nav.route.directory} tracks={tracks} playlists={playlists} albums={libraryAlbums} artists={libraryArtists} stats={listening} ranks={addedRank} onArtist={artist=>nav.push({view:"library",artist})} onAlbum={p=>nav.push({view:"library",playlistId:p.id})} onPlay={(items,index)=>void player.playList(items,index)} onBack={()=>nav.push({view:"library"})} /> : nav.route.playlistId && !activePlaylist ? <section className="empty-state">
              {collection?.error ? <>
                <p role="alert">{collection.error}</p>
                <button className="button secondary" onClick={() => setCollectionRetry(value => value + 1)}>Reintentar</button>
                <button className="text-button" onClick={() => setActivePlaylist(undefined)}>Volver</button>
              </> : feedLink ? <p role="status">Abriendo colección…</p> : <>
                <p>Esta colección ya no está en tu biblioteca.</p>
                <button className="text-button" onClick={() => setActivePlaylist(undefined)}>Volver a la biblioteca</button>
              </>}
            </section> : activePlaylist ? (
              <>
                <motion.header
                  className={"collection-hero" + (isAlbum ? " is-album" : "")}
                  style={collectionTone ? ({ "--tone": collectionTone } as MotionStyle) : undefined}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: reduced ? 0.1 : 0.35, ease: settle }}
                >
                  <div className="collection-backdrop" aria-hidden="true">
                    <Cover track={{ artworkUrl: collectionArt, customArtwork: activePlaylist.customArtwork }} />
                  </div>
                  <motion.div
                    className="collection-cover"
                    initial={{ opacity: 0, scale: reduced ? 1 : 0.92, y: reduced ? 0 : 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: reduced ? 0.1 : 0.5, ease: settle }}
                  >
                    <Cover track={{ artworkUrl: collectionArt, videoId: displayedPlaylistItems[0]?.videoId, customArtwork: activePlaylist.customArtwork, artworkFrame: activePlaylist.artworkFrame }} large />
                  </motion.div>
                  <div className="collection-copy">
                    <span className="eyebrow">
                      {isAlbum ? "Álbum" : feedId?.startsWith("RD") ? "Mix" : activePlaylist.source === "hybrid" ? "Playlist híbrida" : "Playlist"}
                    </span>
                    <h1>{activePlaylist.title}</h1>
                    {collectionArtist && (
                      <button className="text-button artist-link"
                        onClick={() => nav.push({ view: "library", artist: collectionArtist.split(/\s*(?:,|&)\s*/)[0] })}>
                        {collectionArtist}
                      </button>
                    )}
                    <p className="collection-meta">
                      <Badge source={activePlaylist.source} />
                      {[activePlaylist.year, displayedPlaylistItems.length + " canciones", collectionLength]
                        .filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="profile-actions">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      className="button primary"
                      disabled={!displayedPlaylistItems.length}
                      onClick={() => {
                        haptic();
                        void player.playList(displayedPlaylistItems);
                      }}
                    >
                      <Play size={19} fill="currentColor" />
                      Reproducir
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      className="icon-button round-action"
                      aria-label="Reproducir en aleatorio"
                      disabled={displayedPlaylistItems.length < 2}
                      onClick={() => void shufflePlay(displayedPlaylistItems)}
                    >
                      <Shuffle size={21} />
                    </motion.button>
                    {collection?.data && (
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        className="icon-button round-action"
                        aria-label="Guardar colección en tu biblioteca"
                        onClick={() => {
                          const data = collection.data;
                          if (!data) return;
                          void guard(async () => {
                            const saved = await saveCollection(data);
                            haptic("confirm");
                            nav.push({ view: "library", playlistId: saved.id }, true);
                            notify("Colección guardada", "success");
                          });
                        }}
                      >
                        <Plus size={21} />
                      </motion.button>
                    )}
                    <OverflowMenu label="Más opciones de la colección" entries={collectionMenu} />
                  </div>
                </motion.header>
                {displayedPlaylistItems.length > 8 && (
                  <label className="collection-search">
                    <Search size={18} aria-hidden="true" />
                    <input
                      type="search"
                      enterKeyHint="search"
                      aria-label={isAlbum ? "Buscar en este álbum" : "Buscar en esta playlist"}
                      placeholder={isAlbum ? "Buscar en este álbum" : "Buscar en esta playlist"}
                      value={collectionQuery}
                      onChange={(event) => setCollectionQuery(event.target.value)}
                    />
                    {collectionQuery && (
                      <button className="icon-button" aria-label="Limpiar búsqueda" onClick={() => setCollectionQuery("")}>
                        <X size={17} />
                      </button>
                    )}
                  </label>
                )}
                {collectionQuery.trim() ? (
                  collectionMatches.length ? (
                    <>
                      <p className="collection-count">{collectionMatches.length} de {displayedPlaylistItems.length} canciones</p>
                      {/* A match plays the whole collection from that song, not only the results. */}
                      {collectionMatches.slice(0, 120).map((t) =>
                        songRow(t, displayedPlaylistItems.indexOf(t), displayedPlaylistItems, undefined, isAlbum))}
                    </>
                  ) : (
                    <p className="collection-count">Ninguna canción coincide con «{collectionQuery.trim()}».</p>
                  )
                ) : displayedPlaylistItems
                  .slice(0, visibleSongs)
                  .map((t, i) => songRow(t, i, displayedPlaylistItems, undefined, isAlbum))}
                {!collectionQuery.trim() && displayedPlaylistItems.length > visibleSongs && (
                  <button
                    className="button secondary full"
                    onClick={() => setVisibleSongs((n) => n + 80)}
                  >
                    Mostrar más · {visibleSongs} de {displayedPlaylistItems.length}
                  </button>
                )}
                {!displayedPlaylistItems.length && (
                  <div className="empty-state">
                    <ListMusic />
                    <h2>{busy ? "Preparando tu mix…" : "Esta playlist aún no tiene canciones locales"}</h2>
                    <p>Añade canciones desde el menú de búsqueda.</p>
                    <button
                      className="button secondary"
                      onClick={() => setTab("search")}
                    >
                      Buscar canciones
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="page-title title-action">
                  <div>
                    <h1>Tu Biblioteca</h1>
                    <p>Todo lo tuyo. En el mismo lugar.</p>
                  </div>
                  <OverflowMenu label="Opciones de tu biblioteca" entries={libraryMenu} />
                </div>
                <LibrarySearchBox value={libraryQuery} onChange={setLibraryQuery} />
                {libraryResults ? (
                  <LibraryResults
                    query={librarySearchText}
                    results={libraryResults}
                    renderSong={(t) => songRow(t, librarySongPosition.get(t.id) ?? 0, librarySongs)}
                    onAlbum={(album) =>
                      void guard(async () => {
                        const p = await albumPlaylist(album);
                        nav.push({ view: "library", playlistId: p.id });
                      })
                    }
                    onArtist={(artist) => nav.push({ view: "library", artist: artist.name })}
                    onPlaylist={(p) => void guard(() => openPlaylist(p))}
                    onSearchEverywhere={() => startSearch(librarySearchText, "all")}
                  />
                ) : (
                  <>
                    <div className="library-links">
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => nav.push({ view: "library", directory: "artists" })}>Artistas</motion.button>
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => nav.push({ view: "library", directory: "albums" })}>Álbumes</motion.button>
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => nav.push({ view: "library", directory: "insights" })}>
                        <BarChart3 size={15} aria-hidden="true" />Tu resumen
                      </motion.button>
                    </div>
                    <div className="pills">
                      {["Canciones", "Playlists", ...(hasDownloads || filter === "Descargas" ? ["Descargas"] : [])].map((f) => (
                        <button
                          key={f}
                          className={
                            filter === f ||
                            (f === "Canciones" &&
                              !["Playlists", "Descargas"].includes(filter))
                              ? "active"
                              : ""
                          }
                          onClick={() => setFilter(f)}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                    {filter === "Playlists" ? (
                      <>
                        {playlists.length > 0 && (
                          <LibraryToolbar
                            count={`${playlists.length.toLocaleString("es")} ${playlists.length === 1 ? "playlist" : "playlists"}`}
                            query={categoryQuery}
                            onQuery={setCategoryQuery}
                            placeholder="Buscar playlists"
                            resetKey={playlistSort}
                            sort={<SortChip noun="playlists" options={PLAYLIST_SORTS} value={playlistSort} onChange={setPlaylistSort} />}
                          />
                        )}
                        {categorySearchText && (
                          <p className="collection-count" role="status">
                            {!libraryPlaylists.items.length
                              ? `Ninguna playlist coincide con «${categorySearchText}».`
                              : libraryPlaylists.fuzzy
                                ? `Sin coincidencias exactas · ${libraryPlaylists.items.length} parecidas a «${categorySearchText}»`
                                : `${libraryPlaylists.items.length} de ${playlists.length} playlists`}
                          </p>
                        )}
                        {libraryPlaylists.items.map((p) => (
                          <button
                            className="playlist-row"
                            key={p.id}
                            onClick={() => void guard(() => openPlaylist(p))}
                          >
                            <Cover track={playlistArt(p)} size="small" />
                            <span>
                              <strong>{p.title}</strong>
                              <small>
                                {p.trackIds.length} canciones ·{" "}
                                {p.source === "hybrid"
                                  ? "Playlist híbrida"
                                  : p.source}
                              </small>
                            </span>
                            <Badge source={p.source} />
                          </button>
                        ))}
                        {!categorySearchText && (
                          <button
                            className="create-playlist"
                            onClick={() => setNewPlaylist(true)}
                          >
                            <Plus />
                            Crear playlist híbrida
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {categorySongs.length > 0 && (
                          <LibraryToolbar
                            count={songsLabel(categorySongs.length)}
                            query={categoryQuery}
                            onQuery={setCategoryQuery}
                            placeholder={filter === "Descargas" ? "Buscar descargas" : "Buscar canciones"}
                            resetKey={filter === "Descargas" ? downloadSort : songSort}
                            sort={
                              filter === "Descargas" ? (
                                <SortChip noun="descargas" options={SONG_SORTS} value={downloadSort} onChange={setDownloadSort} />
                              ) : (
                                <SortChip noun="canciones" options={SONG_SORTS} value={songSort} onChange={setSongSort} />
                              )
                            }
                          />
                        )}
                        {categorySearchText && (
                          <p className="collection-count" role="status">
                            {!categorySongMatches.items.length
                              ? `Ninguna canción coincide con «${categorySearchText}».`
                              : categorySongMatches.fuzzy
                                ? `Sin coincidencias exactas · ${categorySongMatches.items.length} parecidas a «${categorySearchText}»`
                                : `${categorySongMatches.items.length.toLocaleString("es")} de ${songsLabel(categorySongs.length)}`}
                          </p>
                        )}
                        {/* A song plays the whole list from there, as in a playlist search. */}
                        {categorySongMatches.items
                          .slice(0, visibleSongs)
                          .map((t) => songRow(t, categorySongPosition.get(t.id) ?? 0, categorySongs))}
                        {categorySongMatches.items.length > visibleSongs && (
                          <button
                            className="button secondary full"
                            onClick={() => setVisibleSongs((n) => n + 80)}
                          >
                            Mostrar más · {visibleSongs} de {categorySongMatches.items.length.toLocaleString("es")}
                          </button>
                        )}
                      </>
                    )}
                    {(filter === "Descargas"
                      ? !tracks.some((t) => t.offlinePath)
                      : filter !== "Playlists" && !tracks.length) && (
                      <div className="empty-state">
                        <Library size={42} />
                        <h2>
                          {filter === "Descargas"
                            ? "Tu música, también sin señal"
                            : "Empieza a hacerla tuya"}
                        </h2>
                        <p>
                          {filter === "Descargas"
                            ? "Descarga audio desde el menú de una canción de YouTube."
                            : "Guarda canciones con + o conecta tus cuentas para importar tu biblioteca."}
                        </p>
                        <button
                          className="button primary"
                          onClick={() =>
                            setTab(
                              filter === "Descargas" ? "search" : "connections",
                            )
                          }
                        >
                          {filter === "Descargas"
                            ? "Buscar música"
                            : "Conectar mi música"}
                          <ArrowUpRight size={18} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
        {tab === "connections" && (
          <div className="page connections">
            <div className="page-title">
              <h1>Tus dos mundos</h1>
              <p>Conecta tus cuentas. Conserva el control.</p>
            </div>
            <AppearanceSettings appearance={appearance} notify={notify} />
            <ConnectionsPanel
              status={status}
              onStatus={setStatus}
              notify={notify}
              onSearch={() => startSearch("", "youtube")}
            />
            <div className="section-heading">
              <h2>A tu manera</h2>
            </div>
            <div className="settings-section">
              <div className="setting-label">
                <Shuffle size={21} />
                <div>
                  <strong>Auto-Mix</strong>
                  <p>Potencia constante entre pistas de YouTube</p>
                </div>
              </div>
              <div className="segmented">
                {modes.map((m) => (
                  <button
                    key={m.value}
                    className={state.mode === m.value ? "active" : ""}
                    onClick={() => void guard(() => player.setMode(m.value))}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="setting-label">
                <Moon size={21} />
                <div>
                  <strong>Temporizador de sueño</strong>
                  <p>Cierre gradual de 15 segundos</p>
                </div>
                <select
                  aria-label="Temporizador de sueño"
                  value={sleep.mode === "track" ? "track" : sleep.mode === "minutes" ? sleep.minutes : 0}
                  onChange={(e) =>
                    void chooseSleep(e.target.value === "track" ? "track" : Number(e.target.value))
                  }
                >
                  <option value="0">Off</option>
                  {sleepChoices.map((n) => (
                    <option value={n} key={n}>
                      {n} min
                    </option>
                  ))}
                  <option value="track">Al terminar la canción</option>
                </select>
              </div>
              <label className="setting-label setting-toggle">
                <Vibrate size={21} />
                <div>
                  <strong>Respuesta háptica</strong>
                  <p>Una vibración breve al reproducir, saltar y guardar</p>
                </div>
                <input
                  type="checkbox"
                  checked={haptics}
                  onChange={(event) => {
                    setHapticsEnabled(event.target.checked);
                    setHaptics(event.target.checked);
                    if (event.target.checked) haptic("confirm");
                  }}
                />
              </label>
              <details className="settings-fold">
              <summary>
                <Mic size={21} />
                <span><strong>Voz y permisos</strong><small>Control por voz, reconocimiento y micrófono</small></span>
                <ChevronDown size={18} className="fold-chevron" />
              </summary>
              <button
                className="setting-label setting-button"
                onClick={() => void listen()}
                disabled={voiceBusy}
              >
                <Mic size={21} />
                <div>
                  <strong>Control por voz</strong>
                  <p>“Siguiente”, “Reproduce Misfits”, “Mezcla ahora”</p>
                </div>
                <ArrowUpRight size={18} />
              </button>
              <WakeWordSetting notify={notify} />
              <VoiceExtrasSetting notify={notify} />
              <SmartDownloadsSetting notify={notify} />
              <button
                className="setting-label setting-button"
                onClick={() =>
                  void guard(async () => {
                    if (!isNative)
                      throw new Error(
                        "Consulta el reconocimiento de voz desde Android.",
                      );
                    const s = await Voice.status();
                    if (!s.available)
                      throw new Error(
                        "Activa un servicio de reconocimiento en los ajustes de voz de Android.",
                      );
                    if (s.microphone !== "granted")
                      throw new Error(
                        "Micrófono sin permiso. Pulsa Permisos de la app para habilitarlo.",
                      );
                    notify(
                      s.onDevice
                        ? "Micrófono autorizado. Hay un servicio local; español debe estar descargado."
                        : "La voz puede requerir conexión y un servicio de reconocimiento instalado.",
                    );
                  })
                }
              >
                <ShieldCheck size={21} />
                <div>
                  <strong>Voz y privacidad</strong>
                  <p>El reconocimiento offline depende del teléfono</p>
                </div>
                <ArrowUpRight size={18} />
              </button>
              <button
                className="setting-label setting-button"
                onClick={() =>
                  void guard(async () => {
                    if (!isNative)
                      throw new Error(
                        "Los permisos se administran desde la app Android.",
                      );
                    await Voice.openSettings();
                  })
                }
              >
                <Mic size={21} />
                <div>
                  <strong>Permisos de la app</strong>
                  <p>Micrófono y notificaciones en Ajustes de Android</p>
                </div>
                <ArrowUpRight size={18} />
              </button>
              </details>
            </div>
            <details className="settings-fold advanced-fold">
            <summary>
              <ShieldCheck size={21} />
              <span><strong>Avanzado</strong><small>Modelo sin conexión, diagnóstico y respaldo</small></span>
              <ChevronDown size={18} className="fold-chevron" />
            </summary>
            <div className="settings-section model-section">
              <button
                className="setting-label setting-button"
                disabled={busy === "model"}
                onClick={() =>
                  void guard(async () => {
                    if (!isNative)
                      throw new Error("Descarga el modelo desde Android.");
                    setBusy("model");
                    try {
                      const result = await Voice.downloadModel();
                      notify(result.message);
                    } finally {
                      setBusy("");
                    }
                  })
                }
              >
                <Download size={21} />
                <div>
                  <strong>
                    {busy === "model"
                      ? "Descargando modelo…"
                      : "Mixes por vibra sin conexión"}
                  </strong>
                  <p>Descargar embeddings · 6 MB · verificación SHA-256</p>
                </div>
                <ArrowUpRight size={18} />
              </button>
            </div>
            <PlaybackDiagnostics
              status={status}
              online={online}
              version={APP_VERSION}
              notify={notify}
            />
            <div className="section-heading">
              <h2>Tu biblioteca va contigo</h2>
              <ShieldCheck size={20} />
            </div>
            <p className="help-copy">
              Respalda canciones, playlists, historial y afinidades. Tus
              sesiones de cuenta no se exportan.
            </p>
            <div className="backup-buttons">
              <button
                className="button secondary"
                onClick={() => void guard(exportData)}
              >
                <Download size={18} />
                Exportar JSON
              </button>
              <button
                className="button secondary"
                onClick={() => inputFile.current?.click()}
              >
                <Upload size={18} />
                Importar JSON
              </button>
              <input
                type="file"
                accept="application/json,.json"
                ref={inputFile}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void guard(async () => {
                      await importBackup(await f.text());
                      notify(
                        "Respaldo importado. Biblioteca fusionada sin borrar canciones.",
                      );
                    });
                  e.currentTarget.value = "";
                }}
              />
            </div>
            </details>
            <p className="privacy-note">
              <ShieldCheck size={16} />
              Biblioteca y ajustes guardados en este dispositivo · MURMUR {APP_VERSION}
            </p>
          </div>
        )}
        </div>
      </main>
      <div className="bottom-shell">
        <AnimatePresence>
        {current && (
          <motion.div
            key="mini"
            className="mini-slot"
            initial={{ opacity: 0, y: reduced ? 0 : 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : 14, transition: { duration: (reduced ? motionMs.reduced : motionMs.swapOut) / 1000, ease: release } }}
            transition={{ duration: (reduced ? motionMs.reduced : motionMs.playerIn) / 1000, ease: settle }}
            {...miniRise}
          >
          <SwipeSurface
            className={"mini-player" + (tone ? " toned" : "")}
            style={tone ? ({ "--tone": tone } as React.CSSProperties) : undefined}
            fling=".mini-track:not([data-leaving])"
            onSwipe={(direction) => {
              haptic();
              // Anterior past the first seconds restarts the song: then the cover springs back instead.
              const live = player.getSnapshot();
              const changes = direction < 0
                ? !!player.nextTrack
                : live.index > 0 && !(live.position > 3 && !live.loading);
              if (changes) miniFlungAt.current = performance.now();
              void guard(() =>
                direction < 0 ? player.next() : player.previous(),
              );
              return changes;
            }}
          >
            <button
              className="mini-info"
              aria-label="Abrir reproductor"
              onClick={() => setExpanded(true)}
            >
              <MiniTrackSwap
                swapKey={current.queueId || current.id}
                swap={{ dir: -coverDirection, flung: performance.now() - miniFlungAt.current < 600 }}
              >
                <Cover track={current} size="small" />
                <span className="mini-copy">
                  <strong><MarqueeTitle text={current.title} /></strong>
                  <small>
                    {current.artist}{" "}
                    <span className="mini-source">
                      {current.source === "spotify" ? "SPOTIFY" : "YT AUDIO"}
                    </span>
                  </small>
                </span>
              </MiniTrackSwap>
            </button>
            <button
              className="icon-button"
              aria-label="Guardar canción"
              onClick={() => {
                haptic("confirm");
                void guard(() => save(current));
              }}
            >
              <MotionGlyph state={tracks.some(t => t.id === current.id) ? "saved" : "save"}>
                {tracks.some(t => t.id === current.id) ? <Check size={22} className="highlight" /> : <Plus size={22} />}
              </MotionGlyph>
            </button>
            <button
              className="icon-button"
              aria-label={
                state.playing || state.loading ? "Pausar" : "Reproducir"
              }
              onClick={() => {
                haptic();
                void player.toggle();
              }}
            >
              <MotionGlyph state={state.loading ? "loading" : state.playing ? "pause" : "play"}>
              {state.loading ? (
                <RefreshCw className="spin" size={24} />
              ) : state.playing ? (
                <Pause size={25} fill="currentColor" />
              ) : (
                <Play size={25} fill="currentColor" />
              )}
              </MotionGlyph>
            </button>
            <MiniProgress key={current.queueId || current.id} position={state.position} duration={length}
              playing={state.playing && !state.loading} />
          </SwipeSurface>
          </motion.div>
        )}
        </AnimatePresence>
        <nav className="bottom-nav" aria-label="Navegación principal">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "selected" : ""}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => {
                setTab(t.id);
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                {tab === t.id && (reduced
                  ? <span className="nav-selection" />
                  : <motion.span className="nav-selection" layoutId="bottom-nav-selection"
                      transition={{ type: "spring", stiffness: 580, damping: 43, mass: 0.75 }} />)}
                <t.icon size={22} />
              </span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <PlayerLayer open={expanded && !!current} onDismiss={() => setExpanded(false)} riseRef={playerRise}>
        {current && (
          <>
            <PlayerBackdrop url={currentArtwork} />
            <div className="player-top">
              <button
                className="icon-button"
                aria-label="Cerrar reproductor"
                onClick={() => setExpanded(false)}
              >
                <ChevronDown />
              </button>
              {/* Pull handle: the whole panel follows a downward drag from here (PlayerLayer). */}
              <div className="player-dismiss-grip">
                REPRODUCIENDO DESDE
                <br />
                <b>
                  {current.source === "youtube"
                    ? "YOUTUBE AUDIO"
                    : state.deviceName.includes("MURMUR")
                      ? "SPOTIFY INTEGRADO"
                      : "SPOTIFY CONNECT"}
                </b>
              </div>
              <div className="player-top-actions">
                {isNative && (
                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    className="icon-button"
                    aria-label="Pantalla musical animada"
                    onClick={() => void guard(() => Audio.openVisualizer())}
                  >
                    <Sparkles size={21} />
                  </motion.button>
                )}
                <button
                  className="icon-button"
                  aria-label="Opciones de canción"
                  onClick={() => setActionTrack(current)}
                >
                  <MoreVertical />
                </button>
              </div>
            </div>
            <div className="player-body">
              <motion.div
                className="cover-swipe"
                drag={reduced ? false : "x"}
                dragDirectionLock
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.32}
                dragSnapToOrigin
                whileDrag={{ scale: 0.97 }}
                onDragEnd={(_, info) => {
                  const distance = info.offset.x + info.velocity.x * 0.18;
                  if (Math.abs(distance) < 90) return;
                  haptic();
                  void guard(() => (distance < 0 ? player.next() : player.previous()));
                }}
              >
                {/* Double-tap saves (the same save as "Guardar canción actual"); saved already: only the heart. */}
                <CoverDoubleTap
                  onDoubleTap={() => {
                    if (!allTracks.some((t) => t.id === current.id && t.saved !== false))
                      void guard(() => save(current));
                  }}
                >
                  <AmbientCover track={current} direction={coverDirection} />
                </CoverDoubleTap>
              </motion.div>
              <div className="now-title">
                <motion.div
                  key={current.queueId || current.id}
                  initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduced ? 0.1 : 0.32, ease: settle, delay: reduced ? 0 : 0.04 }}
                >
                  <h1><MarqueeTitle text={current.title} /></h1>
                  {/* Artist and album share one truncated line so long names never push the controls off screen. */}
                  <div className="now-sub">
                    <button className="text-button artist-link" onClick={()=>nav.push({view:"library",artist:current.artist.split(", ")[0]})}>{current.artist}</button>
                    {current.album&&<><span aria-hidden="true">·</span><button className="text-button artist-link album-link" aria-label={"Ver álbum " + current.album} onClick={()=>void guard(()=>openTrackAlbum(current))}>{current.album}</button></>}
                  </div>
                </motion.div>
                <button
                  className="icon-button"
                  aria-label="Guardar canción actual"
                  onClick={() => {
                    haptic("confirm");
                    void guard(() => save(current));
                  }}
                >
                  {tracks.some((t) => t.id === current.id) ? (
                    <Check className="highlight" />
                  ) : (
                    <Plus />
                  )}
                </button>
              </div>
              <div className="quality-line">
                <Badge source={current.source} />
                <span>
                  {current.source === "spotify"
                    ? (state.deviceName.includes("MURMUR")
                        ? "SPOTIFY INTEGRADO"
                        : "SPOTIFY CONNECT") +
                      (state.deviceName ? " · " + state.deviceName : "")
                    : current.offlinePath
                      ? "AUDIO LOCAL · OFFLINE"
                      : "AUDIO · MEJOR DISPONIBLE"}
                </span>
                {state.playing && <Equalizer />}
              </div>
              <SeekBar
                key={current.queueId || current.id}
                position={state.position}
                duration={length}
                playing={state.playing && !state.loading}
                onError={(message) => notify(message, "error")}
              />
              <div className="transport">
                <button
                  className={"icon-button shuffle-button mode-" + state.shuffleMode}
                  aria-label={
                    state.shuffleMode === "off" ? "Activar aleatorio"
                      : state.shuffleMode === "on" ? "Activar aleatorio mágico"
                        : "Desactivar aleatorio"
                  }
                  aria-pressed={state.shuffleMode !== "off"}
                  disabled={state.shuffleMode === "off" && state.queue.length - state.index - 1 < 2}
                  onClick={() => {
                    haptic(state.shuffleMode === "on" ? "confirm" : undefined);
                    void player.cycleShuffle(magicPicks).then((message) => message && notify(message));
                  }}
                >
                  <Shuffle className={state.shuffleMode !== "off" ? "highlight" : ""} size={23} />
                  {state.shuffleMode === "magic" && <Sparkles className="shuffle-magic" size={12} aria-hidden="true" />}
                </button>
                <button
                  className="icon-button"
                  aria-label="Anterior"
                  onClick={() => {
                    haptic();
                    void guard(() => player.previous());
                  }}
                >
                  <SkipBack size={29} fill="currentColor" />
                </button>
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  className="play-main"
                  aria-label={
                    state.playing || state.loading ? "Pausar" : "Reproducir"
                  }
                  onClick={() => {
                    haptic();
                    void player.toggle();
                  }}
                >
                  <MotionGlyph state={state.loading ? "loading" : state.playing ? "pause" : "play"}>
                  {state.loading ? (
                    <span className="buffering-control">
                      <RefreshCw className="spin" size={44} />
                      <Pause size={23} fill="currentColor" />
                    </span>
                  ) : state.playing ? (
                    <Pause size={30} fill="currentColor" />
                  ) : (
                    <Play size={30} fill="currentColor" />
                  )}
                  </MotionGlyph>
                </motion.button>
                <button
                  className="icon-button"
                  aria-label="Siguiente"
                  onClick={() => {
                    haptic();
                    void guard(() => player.next());
                  }}
                >
                  <SkipForward size={29} fill="currentColor" />
                </button>
                <button
                  className="icon-button"
                  aria-label="Mostrar cola"
                  onClick={() => {
                    setQueueVisible(true);
                    setTimeout(
                      () =>
                        document
                          .querySelector(".queue-anchor")
                          ?.scrollIntoView({
                            behavior: reduced ? "instant" : "smooth",
                            block: "start",
                          }),
                      60,
                    );
                  }}
                >
                  <ListMusic size={23} />
                </button>
              </div>
              <div className="mix-controls">
                <button
                  className="mix-now"
                  disabled={!player.nextTrack}
                  onClick={() => void guard(() => player.mixNow())}
                >
                  <AudioLines size={18} />
                  Mezclar ahora
                </button>
              </div>
              <p className="mix-mode-note">
                Auto-Mix · {modes.find((m) => m.value === state.mode)?.label}
              </p>
              {state.error && (
                <div className="error-box" role="alert">
                  <p>{state.error}</p>
                  <button
                    className="text-button"
                    onClick={() => void player.playCurrent()}
                  >
                    Reintentar
                  </button>
                  {current.source === "spotify" && (
                    <button className="text-button" onClick={() => {
                      setExpanded(false);
                      setTab("connections");
                    }}>
                      Revisar conexión de Spotify
                    </button>
                  )}
                  <button className="text-button" onClick={() => {
                    setExpanded(false);
                    startSearch(current.artist + " " + current.title, "youtube");
                  }}>
                    Buscar otra versión en YouTube
                  </button>
                </div>
              )}
              {!!current.chapters?.length && (
                <section className="chapters">
                  <h2>En este concierto</h2>
                  {current.chapters.map((c) => (
                    <button
                      key={c.positionMs}
                      onClick={() =>
                        void guard(() => player.seek(c.positionMs / 1000))
                      }
                    >
                      <span>{time(c.positionMs / 1000)}</span>
                      {c.title}
                      <Play size={14} />
                    </button>
                  ))}
                </section>
              )}
              <button
                className="expand-section"
                aria-expanded={lyricsOpen}
                onClick={() => setLyricsOpen(!lyricsOpen)}
              >
                <span>Letras</span>
                <ChevronDown className={lyricsOpen ? "rotate" : ""} />
              </button>
              <AnimatePresence initial={false}>
              {lyricsOpen && (
                <Unfold key="lyrics">
                <div className="lyrics">
                  {lyrics.length ? (
                    <SyncedLyrics
                      lines={lyrics}
                      position={state.position}
                      onSeek={(seconds) => void guard(() => player.seek(seconds))}
                    />
                  ) : lyricsState?.result?.plain ? (
                    <p className="lyrics-plain">{lyricsState.result.plain}</p>
                  ) : lyricsState?.failed ? (
                    <>
                      <p role="status">No se pudo cargar la letra. Revisa tu conexión.</p>
                      <button className="text-button" onClick={() => setLyricsRetry(value => value + 1)}>Reintentar letras</button>
                    </>
                  ) : !lyricsState ? (
                    <div className="lyrics-loading" role="status" aria-label="Buscando letra">
                      <span className="skeleton" />
                      <span className="skeleton" />
                      <span className="skeleton" />
                    </div>
                  ) : (
                    <p>{lyricsState.result?.instrumental ? "Esta pista es instrumental." : "No encontramos la letra de esta versión."}</p>
                  )}
                  {(lyrics.length > 0 || lyricsState?.result?.plain) && (
                    <small className="lyrics-credit">Letra · {lyricsState?.result?.source || "LRCLIB"}</small>
                  )}
                  {lyricsState && !lyrics.length && !lyricsState.result?.plain && !lyricsState.result?.instrumental &&
                  <a className="text-button lyrics-genius" href={geniusLyricsUrl(current)}
                    target="_blank" rel="noopener noreferrer" onClick={event => {
                      if (!isNative || status.preview) return;
                      event.preventDefault();
                      void guard(() => Audio.openGeniusLyrics({ url: geniusLyricsUrl(current) }));
                    }}>
                    Buscar letra en Genius <ArrowUpRight size={16} aria-hidden="true" />
                  </a>}
                </div>
                </Unfold>
              )}
              </AnimatePresence>
              <button
                className="expand-section queue-anchor"
                aria-expanded={queueVisible}
                onClick={() => setQueueVisible(!queueVisible)}
              >
                <span>
                  A continuación{" "}
                  <small>
                    {Math.max(0, state.queue.length - state.index - 1)}
                  </small>
                </span>
                <ChevronDown className={queueVisible ? "rotate" : ""} />
              </button>
              <AnimatePresence initial={false}>
              {queueVisible && (
                <Unfold key="queue">
                <PlaybackQueue tracks={state.queue.slice(state.index + 1)}>
                  {(t, queueIndex, handlers) => (
                    <QueueRow
                      track={t}
                      key={t.queueId || t.id + queueIndex}
                      {...handlers}
                      onRemove={() => removeFromQueue(t)}
                      onMenu={() => setActionTrack(t)}
                    >
                      <div className="queue-move">
                        <button
                          className="icon-button"
                          aria-label={"Subir " + t.title}
                          disabled={queueIndex === 0}
                          onClick={() => {
                            const items = [...state.queue];
                            const at = state.index + 1 + queueIndex;
                            [items[at - 1], items[at]] = [
                              items[at],
                              items[at - 1],
                            ];
                            player.reorder(items);
                          }}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={"Bajar " + t.title}
                          disabled={
                            queueIndex === state.queue.length - state.index - 2
                          }
                          onClick={() => {
                            const items = [...state.queue];
                            const at = state.index + 1 + queueIndex;
                            [items[at + 1], items[at]] = [
                              items[at],
                              items[at + 1],
                            ];
                            player.reorder(items);
                          }}
                        >
                          <ArrowDown size={16} />
                        </button>
                      </div>
                      <Cover track={t} size="small" />
                      <button
                        className="queue-track"
                        aria-label={"Reproducir ahora " + t.title}
                        onClick={() => void player.playQueueEntry(t.queueId!)}
                      >
                        <strong><MarqueeTitle text={t.title} /></strong>
                        <small>{t.smart && <span className="smart-mark">✦ Sugerida · </span>}{t.artist}</small>
                      </button>
                      <Badge source={t.source} />
                    </QueueRow>
                  )}
                </PlaybackQueue>
                </Unfold>
              )}
              </AnimatePresence>
            </div>
          </>
        )}
      </PlayerLayer>
      <AnimatePresence>
        {coverTarget && coverItem && (
          <CoverEditor
            key="cover-editor"
            title={coverItem.title}
            item={coverItem}
            onSave={saveCover}
            onClose={() => setCoverTarget(undefined)}
            notify={notify}
          />
        )}
      </AnimatePresence>
      <AnimatePresence custom={sheetThrown.current}>
        {sheetOpen && (
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: "none", transition: { duration: 0.17, ease: release } }}
            transition={{ duration: 0.24, ease: settle }}
            onClick={() => {
              setActionTrack(undefined);
              setPlaylistPicker(undefined);
              setNewPlaylist(false);
              setShared(undefined);
              nav.close("sheet", "sleep");
            }}
          >
            <motion.div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-label={
                newPlaylist
                  ? "Crear playlist"
                  : sleepSheet
                    ? "Temporizador de sueño"
                    : "Acciones de canción"
              }
              className="action-sheet"
              drag={reduced ? false : "y"}
              dragControls={sheetDrag}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.05, bottom: 0.75 }}
              dragSnapToOrigin
              onDragEnd={(_, info) => {
                if (info.offset.y < 110 && info.velocity.y < 650) return;
                haptic();
                // Thrown down: it leaves downward from where the finger let go (see the "leave" variant).
                sheetThrown.current = !reduced;
                setActionTrack(undefined);
                setPlaylistPicker(undefined);
                setNewPlaylist(false);
                setShared(undefined);
                nav.close("sheet", "sleep");
              }}
              initial={{ y: reduced ? 0 : 42, opacity: reduced ? 1 : 0.72 }}
              animate={{ y: 0, opacity: 1 }}
              variants={{
                leave: (thrown: boolean, current: { y?: unknown }) =>
                  thrown
                    ? {
                        y: (Number(current.y) || 0) + Math.round(window.innerHeight * 0.6),
                        opacity: 0,
                        transition: {
                          y: { type: "spring", duration: 0.28, bounce: 0 },
                          opacity: { duration: 0.2, ease: release, delay: 0.04 },
                        },
                      }
                    : { y: reduced ? 0 : 30, opacity: 0, transition: { duration: 0.16, ease: release } },
              }}
              exit="leave"
              transition={{ duration: reduced ? 0.1 : 0.29, ease: settle }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="sheet-handle"
                aria-hidden="true"
                onPointerDown={(event) => {
                  if (!reduced) sheetDrag.start(event);
                }}
              />
              <button
                className="sheet-close icon-button"
                aria-label="Cerrar opciones"
                onClick={() => {
                  setActionTrack(undefined);
                  setPlaylistPicker(undefined);
                  setNewPlaylist(false);
                  setShared(undefined);
                  nav.close("sheet", "sleep");
                }}
              >
                <X size={20} />
              </button>
              {sleepSheet ? (
                <>
                  <h2>Temporizador de sueño</h2>
                  <p className="help-copy">
                    La música se apaga con un cierre gradual. Sigue funcionando con la pantalla bloqueada.
                  </p>
                  <div className="sleep-options" role="group" aria-label="Detener la música">
                    {sleepChoices.map((minutes) => (
                      <button
                        key={minutes}
                        className="sheet-action"
                        aria-pressed={sleep.mode === "minutes" && sleep.minutes === minutes}
                        onClick={() => {
                          nav.close("sheet", "sleep");
                          void chooseSleep(minutes);
                        }}
                      >
                        <Clock3 size={20} />
                        {minutes} minutos
                        {sleep.mode === "minutes" && sleep.minutes === minutes && <Check size={18} className="highlight" />}
                      </button>
                    ))}
                    <button
                      className="sheet-action"
                      aria-pressed={sleep.mode === "track"}
                      onClick={() => {
                        nav.close("sheet", "sleep");
                        void chooseSleep("track");
                      }}
                    >
                      <Music2 size={20} />
                      Al terminar esta canción
                      {sleep.mode === "track" && <Check size={18} className="highlight" />}
                    </button>
                    {sleep.mode !== "off" && (
                      <button
                        className="sheet-action"
                        onClick={() => {
                          nav.close("sheet", "sleep");
                          void chooseSleep(0);
                        }}
                      >
                        <X size={20} />
                        Desactivar temporizador
                      </button>
                    )}
                  </div>
                </>
              ) : newPlaylist ? (
                <>
                  <h2>Una playlist, tus dos mundos</h2>
                  <label>
                    Nombre de la playlist
                    <input
                      autoFocus
                      value={playlistName}
                      onChange={(e) => setPlaylistName(e.target.value)}
                      placeholder="Mi mix híbrido"
                      maxLength={100}
                    />
                  </label>
                  <button
                    className="button primary full"
                    disabled={!playlistName.trim()}
                    onClick={() =>
                      void guard(async () => {
                        const p: Playlist = {
                          id: "local:" + crypto.randomUUID(),
                          title: playlistName.trim(),
                          source: "hybrid",
                          trackIds: [],
                        };
                        await db.playlists.add(p);
                        setPlaylistName("");
                        if (playlistPicker) {
                          await addToPlaylist(p.id, playlistPicker);
                          nav.close("sheet");
                          notify("Canción añadida a " + p.title);
                        } else {
                          nav.close("sheet");
                          await openPlaylist(p);
                        }
                      })
                    }
                  >
                    Crear playlist
                  </button>
                </>
              ) : playlistPicker ? (
                <>
                  <h2>Guardar en playlist</h2>
                  <p className="help-copy">
                    Las playlists importadas conservan sus originales. Las
                    nuevas canciones viven en tu teléfono.
                  </p>
                  {playlists.map((p) => (
                    <button
                      className="sheet-action"
                      key={p.id}
                      onClick={() =>
                        void guard(async () => {
                          await addToPlaylist(p.id, playlistPicker);
                          setPlaylistPicker(undefined);
                          notify("Añadida a " + p.title);
                          if (activePlaylist?.id === p.id)
                            setPlaylistItems(await playlistTracks(p));
                        })
                      }
                    >
                      <ListMusic size={20} />
                      {p.title}
                      <Badge source={p.source} />
                    </button>
                  ))}
                  <button
                    className="sheet-action"
                    onClick={() => setNewPlaylist(true)}
                  >
                    <Plus size={20} />
                    Crear playlist híbrida
                  </button>
                </>
              ) : (
                <>
                  <div className="sheet-track">
                    <Cover track={actionTrack || shared} size="small" />
                    <div>
                      <strong><MarqueeTitle text={(actionTrack || shared)?.title || ""} /></strong>
                      <p>{(actionTrack || shared)?.artist}</p>
                    </div>
                  </div>
                  {shared && (
                    <button
                      className="sheet-action"
                      onClick={() => {
                        void player.playList([shared]);
                        setShared(undefined);
                      }}
                    >
                      <Play size={20} />
                      Reproducir ahora
                    </button>
                  )}
                  {actionTrack && (
                    <button
                      className="sheet-action"
                      onClick={() => {
                        setCoverTarget({ kind: "track", id: actionTrack.id });
                        setActionTrack(undefined);
                      }}
                    >
                      <ImageIcon size={20} />
                      Cambiar portada
                    </button>
                  )}
                  <button
                    className="sheet-action"
                    onClick={() => {
                      player.enqueue((actionTrack || shared)!);
                      setActionTrack(undefined);
                      setShared(undefined);
                      notify("Añadida a la cola");
                    }}
                  >
                    <ListMusic size={20} />
                    Añadir a la cola
                  </button>
                  <button
                    className="sheet-action"
                    onClick={() => {
                      setPlaylistPicker(actionTrack || shared);
                      setActionTrack(undefined);
                      setShared(undefined);
                    }}
                  >
                    <Plus size={20} />
                    Guardar en Playlist Híbrida
                  </button>
                  <button
                    className="sheet-action"
                    onClick={() => {
                      const track = (actionTrack || shared)!;
                      setActionTrack(undefined);
                      setShared(undefined);
                      void guard(() => save(track));
                    }}
                  >
                    <Heart size={20} />
                    Guardar en mi biblioteca
                  </button>
                  <button className="sheet-action" onClick={()=>nav.push({view:"library",artist:(actionTrack||shared)!.artist.split(", ")[0]})}><Library size={20}/>Ver artista</button>
                  {(actionTrack||shared)?.album&&<button className="sheet-action" onClick={()=>void guard(()=>openTrackAlbum((actionTrack||shared)!))}><Library size={20}/>Ver álbum</button>}
                  {(actionTrack || shared)?.source === "youtube" && (
                    <>
                      <button
                        className="sheet-action"
                        onClick={() => {
                          const track = (actionTrack || shared)!;
                          setActionTrack(undefined);
                          setShared(undefined);
                          void guard(() => download(track));
                        }}
                      >
                        <Download size={20} />
                        Descargar offline
                      </button>
                      <button
                        className="sheet-action"
                        onClick={() =>
                          void guard(async () => {
                            const track = (actionTrack || shared)!;
                            const parsed = parseFanUpload(
                              track.artist + " - " + track.title,
                            );
                            const resolved = await validateArtist(
                              parsed.candidateArtist || track.artist,
                            );
                            if (resolved) {
                              await saveTrack({
                                ...track,
                                artist: resolved.name,
                                tags: [
                                  ...new Set([...track.tags, ...resolved.tags]),
                                ],
                              });
                              notify("Artista validado: " + resolved.name);
                            } else
                              notify(
                                "No se encontró un artista con suficiente coincidencia.",
                              );
                            setActionTrack(undefined);
                          })
                        }
                      >
                        <ShieldCheck size={20} />
                        Validar artista en MusicBrainz
                      </button>
                    </>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {welcome && (
          <Welcome notify={notify} youtubeConnected={!!status.youtubeSession} spotifyConnected={!!status.spotify}
            onDone={() => { setWelcome(false); setTab("home"); }} />
        )}
      </AnimatePresence>
      {/* «¿No era esta?»: the closest options when a voice request was not clear enough. */}
      <VoiceChoices />
      <AnimatePresence mode="wait">
        {(wakeListening || voiceThinking || voiceBusy) && (
          <motion.div
            key={voiceThinking ? "thinking" : "listening"}
            className={"voice-listening" + (voiceThinking ? " thinking" : "")}
            role="status"
            aria-live="polite"
            initial={{ y: reduced ? 0 : -14, opacity: 0, scale: reduced ? 1 : 0.94 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.96, transition: { duration: 0.15, ease: release } }}
            transition={{ duration: 0.26, ease: settle }}
          >
            {voiceThinking ? (
              <>
                <span className="voice-thinking-spinner" aria-hidden="true" />
                <span className="voice-thinking-text">{voiceThinking}</span>
              </>
            ) : (
              <>
                <span className="voice-listening-bars" aria-hidden="true"><i /><i /><i /><i /></span>
                <span>Te escucho…</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            role={toastKind === "error" ? "alert" : "status"}
            className={"snackbar snackbar-" + toastKind}
            key={toast}
            initial={{ y: reduced ? 0 : 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : 5, transition: { duration: 0.13, ease: release } }}
            transition={{ duration: 0.21, ease: settle }}
          >
            <span className="notice-icon" aria-hidden="true">
              {toastKind === "success" ? (
                <Check size={20} />
              ) : toastKind === "error" ? (
                <X size={20} />
              ) : (
                <AudioLines size={20} />
              )}
            </span>
            <span>{toast}</span>
            {toastAction && (
              <button className="snackbar-action" onClick={() => { toastAction.run(); setToast(""); }}>
                {toastAction.label}
              </button>
            )}
            <button aria-label="Cerrar aviso" onClick={() => setToast("")}>
              <X size={17} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Song change: the new cover comes in from the side you are moving to (right on Siguiente, left on
 * Anterior) while the old one leaves the other way, so the gesture and the swipe read as one motion.
 */
function AmbientCover({ track, direction = 1 }: { track: QueueItem; direction?: number }) {
  const reduced = useReducedMotion();
  const shift = reduced ? 0 : 44;
  return (
    <div className="ambient-cover">
      <AnimatePresence initial={false} mode="sync" custom={direction}>
        <motion.div
          className="art-stage"
          key={track.queueId || track.id}
          custom={direction}
          variants={{
            enter: (dir: number) => ({ opacity: 0, x: dir * shift, scale: reduced ? 1 : 0.97 }),
            center: { opacity: 1, x: 0, scale: 1 },
            leave: (dir: number) => ({
              opacity: 0,
              x: -dir * shift * 0.7,
              scale: reduced ? 1 : 0.97,
              transition: { duration: (reduced ? motionMs.reduced : motionMs.swapOut) / 1000, ease: release },
            }),
          }}
          initial="enter"
          animate="center"
          exit="leave"
          transition={{ duration: (reduced ? motionMs.reduced : motionMs.swapIn) / 1000, ease: settle }}
        >
          <Cover track={track} large />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
function QueueRow({
  track,
  children,
  onDragStart,
  onDragEnd,
  onRemove,
  onMenu,
}: {
  onDragStart: () => void;
  onDragEnd: () => void;
  track: QueueItem;
  children: React.ReactNode;
  /** Swipe left: removes it from the queue (false when it may not, e.g. it is now playing). */
  onRemove?: () => boolean;
  /** Hold: the song's menu. */
  onMenu?: () => void;
}) {
  const controls = useDragControls();
  const reduced = useReducedMotion();
  const gestures = useQueueRowGestures({ onRemove, onMenu });
  /** Picked up: the row rises on a spring and its card and shadow fade in under it (motion215.css). */
  const [lifted, setLifted] = useState(false);
  const scrollFrame = useRef(0);
  const scrollSpeed = useRef(0);
  const scrollOwner = useRef<HTMLElement | null>(null);
  const stopScroll = () => {
    cancelAnimationFrame(scrollFrame.current);
    scrollSpeed.current = 0;
  };
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  const autoScroll = () => {
    if (scrollOwner.current && scrollSpeed.current)
      scrollOwner.current.scrollTop += scrollSpeed.current;
    scrollFrame.current = requestAnimationFrame(autoScroll);
  };
  return (
    <Reorder.Item
      ref={gestures.ref}
      value={track.queueId!}
      className="queue-item"
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={gestures.leaving ? gestures.leaveExit : { opacity: 0, x: -24, transition: { duration: 0.16 } }}
      data-lifted={lifted ? "true" : undefined}
      data-leaving={gestures.leaving ? "true" : undefined}
      {...gestures.handlers}
      whileDrag={reduced ? undefined : { scale: 1.03 }}
      onDragStart={() => {
        setLifted(true);
        onDragStart();
        scrollOwner.current = document.querySelector(".expanded-player");
        scrollFrame.current = requestAnimationFrame(autoScroll);
      }}
      onDrag={(event) => {
        const y = (event as PointerEvent).clientY;
        const bounds = scrollOwner.current?.getBoundingClientRect();
        if (bounds && Number.isFinite(y))
          scrollSpeed.current =
            y > bounds.bottom - 64
              ? Math.min(16, (y - bounds.bottom + 64) / 4)
              : y < bounds.top + 64
                ? -Math.min(16, (bounds.top + 64 - y) / 4)
                : 0;
      }}
      onDragEnd={() => {
        stopScroll();
        setLifted(false);
        onDragEnd();
      }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
      dragListener={false}
      dragControls={controls}
    >
      {onRemove && <QueueRemoveReveal />}
      <button
        className="drag-handle"
        aria-label={"Reordenar " + track.title}
        onPointerDown={(event) => {
          if (event.isPrimary && event.button === 0) {
            event.preventDefault();
            controls.start(event);
          }
        }}
      >
        <GripVertical size={18} />
      </button>
      {children}
    </Reorder.Item>
  );
}

function PlaybackQueue({
  tracks,
  children,
}: {
  tracks: QueueItem[];
  children: (
    track: QueueItem,
    index: number,
    handlers: { onDragStart: () => void; onDragEnd: () => void },
  ) => React.ReactNode;
}) {
  const key = tracks.map((t) => t.queueId).join("|");
  const [ids, setIds] = useState(() => tracks.map((t) => t.queueId!));
  const draft = useRef(ids);
  const dragging = useRef(false);
  /** The queue changed under the finger (a song ended mid-drag): reconciled on drop, not mid-gesture. */
  const stale = useRef(false);
  const [limit, setLimit] = useState(80);
  // Rows keep their song while a drag outlives it, so the row under the finger never vanishes or jumps.
  const known = useRef(new Map<string, QueueItem>());
  if (!dragging.current) known.current = new Map();
  for (const t of tracks) known.current.set(t.queueId!, t);
  useEffect(() => {
    if (dragging.current) {
      stale.current = true;
      return;
    }
    const order = tracks.map((t) => t.queueId!);
    draft.current = order;
    setIds(order);
  }, [key]);
  const lookup = known.current;
  const visible = ids.slice(0, limit);
  return (
    <>
      <Reorder.Group
        className="queue"
        axis="y"
        values={visible}
        onReorder={(order) => {
          draft.current = [...order, ...ids.slice(limit)];
          setIds(draft.current);
        }}
      >
        <AnimatePresence initial={false}>
        {visible.map((id, index) => {
          const track = lookup.get(id);
          if (!track) return null;
          return children(track, index, {
            onDragStart: () => {
              dragging.current = true;
            },
            onDragEnd: () => {
              if (!dragging.current) return;
              dragging.current = false;
              const before = player.getSnapshot();
              player.reorderUpcoming(stale.current
                ? settleReorder(draft.current, before.queue.slice(before.index + 1).map((t) => t.queueId!))
                : draft.current);
              stale.current = false;
              const live = player.getSnapshot();
              draft.current = live.queue
                .slice(live.index + 1)
                .map((t) => t.queueId!);
              setIds(draft.current);
            },
          });
        })}
        </AnimatePresence>
      </Reorder.Group>
      {ids.length > limit && (
        <button
          className="button secondary"
          onClick={() => setLimit((v) => v + 80)}
        >
          Mostrar más de la cola
        </button>
      )}
    </>
  );
}
