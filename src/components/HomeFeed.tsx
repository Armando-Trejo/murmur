import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ChevronRight, Play, RefreshCw } from "lucide-react";
import { Audio, Auth, isNative, type ConnectionStatus, type FeedItem, type FeedShelf } from "../native";
import { unwrapSpotifyTrack } from "../core/SpotifyLibrary";
import { settle } from "../core/motion";
import type { QueueItem } from "../core/types";

type Provider = "youtube" | "spotify";
type Feed = { shelves: FeedShelf[]; loading: boolean; error?: string };
const empty: Feed = { shelves: [], loading: false };
const names = { youtube: "YouTube Music", spotify: "Spotify" };

async function loadFeed(provider: Provider): Promise<FeedShelf[]> {
  if (provider === "youtube") {
    return (await Auth.youtubeHome()).shelves ?? [];
  }
  const { data } = await Auth.spotifyRequest({ path: "/me/top/tracks?time_range=short_term&limit=20" });
  if (!Array.isArray(data?.items)) throw Error("Spotify no entregó tus canciones principales.");
  const tracks = data.items.map(unwrapSpotifyTrack).filter(Boolean) as QueueItem[];
  return tracks.length ? [{
    title: "Lo más escuchado recientemente",
    items: tracks.map(track => ({
      id: track.id, title: track.title, subtitle: track.artist, artworkUrl: track.artworkUrl, track,
    })),
  }] : [];
}

function useProviderFeed(provider: Provider, account: number | undefined, enabled: boolean, refresh: number) {
  const [result, setResult] = useState<{ account: number; feed: Feed }>();
  useEffect(() => {
    if (account === undefined) {
      setResult(undefined);
      return;
    }
    if (!enabled) return;
    let live = true;
    setResult(current => ({
      account, feed: { shelves: current?.account === account ? current.feed.shelves : [], loading: true },
    }));
    void loadFeed(provider).then(shelves => {
      if (live) setResult({ account, feed: { shelves, loading: false } });
    }).catch((error: unknown) => {
      if (!live) return;
      const message = provider === "youtube" && error instanceof Object && "message" in error
        ? String(error.message) : `No se pudo cargar ${names[provider]}. Reintenta o revisa la conexión.`;
      setResult(current => ({ account, feed: {
        shelves: current?.account === account ? current.feed.shelves : [], loading: false, error: message,
      } }));
    });
    return () => { live = false; };
  }, [provider, account, enabled, refresh]);
  return account !== undefined && result?.account === account ? result.feed : empty;
}

function FeedSource({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  return <motion.div className="feed-source" aria-hidden={!present || undefined}
    ref={element => { if (element) element.inert = !present; }}
    initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: reduced ? 0 : -4, transition: { duration: 0.13 } }}
    transition={{ duration: reduced ? 0.1 : 0.23, ease: settle }}>
    {children}
  </motion.div>;
}

export function HomeFeed({ active, status, onPlay, onCollection, onConnect, renderArt }: {
  active: boolean;
  status: ConnectionStatus;
  onPlay: (items: QueueItem[], index: number) => void;
  onCollection: (item: FeedItem) => void;
  onConnect: () => void;
  renderArt: (item: FeedItem) => ReactNode;
}) {
  const [filter, setFilter] = useState<"all" | Provider>("all");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [started, setStarted] = useState(active);
  const [error, setError] = useState("");
  const reduced = useReducedMotion();
  useEffect(() => { if (active) setStarted(true); }, [active]);
  const spotify = !!(status.spotify || status.oauth);
  const youtube = !!(status.youtubeSession || status.youtube);
  const feeds = {
    youtube: useProviderFeed("youtube", isNative && youtube ? status.youtubeRevision ?? 0 : undefined, started, revision),
    spotify: useProviderFeed("spotify", isNative && spotify ? status.spotifyRevision ?? 0 : undefined, started, revision),
  };
  // "Todos" shows only the connected sources: a disconnected one is a choice made in Conexiones,
  // not something to nag about at the top of Home. Its own filter still offers to connect it.
  const linked = (["youtube", "spotify"] as const).filter(provider => provider === "youtube" ? youtube : spotify);
  const providers: Provider[] = filter !== "all" ? [filter] : status.preview || !linked.length ? ["youtube", "spotify"] : [...linked];
  if (!isNative) return null;
  return (
    <section className="home-feed" aria-label={status.preview ? "Demostración de Inicio" : "Descubre música"}>
      <div className="feed-heading">
        <h1>{status.preview ? "Explorar la demo" : "Para ti"}</h1>
        {(youtube || spotify) && (
          <button className="icon-button feed-refresh" type="button" aria-label="Actualizar selección"
            onClick={() => setRevision(value => value + 1)}
            disabled={providers.some(provider => feeds[provider].loading)}>
            <RefreshCw size={19} />
          </button>
        )}
      </div>
      <div className="pills feed-filters" aria-label="Fuente de la música">
        {(["all", "youtube", "spotify"] as const).map(value => (
          <button key={value} className={filter === value ? "active" : ""}
            aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === "all" ? "Todos" : names[value]}
          </button>
        ))}
      </div>
      {error && <p className="feed-note" role="alert">{error}</p>}
      <div className="feed-sources">
        <AnimatePresence initial={false}>
          {providers.map(provider => {
            const connected = provider === "youtube" ? youtube : spotify;
            const feed = feeds[provider];
            return <FeedSource key={provider}>
              <div className="feed-heading">
                <h2>{status.preview ? names[provider] : provider === "youtube" ? "Tu Inicio de YouTube Music" : "Tu actividad en Spotify"}</h2>
                {!status.preview && <button className="text-button feed-external"
                  aria-label={`Abrir Inicio en ${names[provider]}`}
                  onClick={() => {
                    setError("");
                    void Audio.openProviderHome({ provider }).catch(() => setError(`No se pudo abrir ${names[provider]}.`));
                  }}>
                  Abrir Inicio <ArrowUpRight size={15} aria-hidden="true" />
                </button>}
              </div>
              {status.preview && connected && <p className="feed-note">Pistas de ejemplo para probar la interfaz.</p>}
              {!connected ? <p className="feed-note">{names[provider]} no está conectado.{" "}
                  <button className="text-button" onClick={onConnect}>Conectar</button></p>
                : feed.loading && !feed.shelves.length ? <div className="feed-skeleton" role="status" aria-label="Cargando tu música">
                    <span className="skeleton feed-skeleton-title" />
                    <div className="feed-grid">
                      {[0, 1, 2, 3].map(index => <span className="feed-card" key={index} aria-hidden="true">
                        <span className="skeleton feed-skeleton-cover" />
                        <span className="skeleton feed-skeleton-line" />
                        <span className="skeleton feed-skeleton-line short" />
                      </span>)}
                    </div>
                  </div>
                : feed.error ? <p className="feed-note" role="status">{feed.error}</p>
                : !feed.shelves.length ? <p className="feed-note">No hay música disponible en esta sección.</p> : null}
              {feed.shelves.map((shelf, index) => {
                const key = `${provider}-${index}`;
                const more = expanded.includes(key);
                const items = more ? shelf.items : shelf.items.slice(0, 4);
                const queue = shelf.items.flatMap(item => item.track ? [item.track] : []);
                return <div className="feed-shelf" key={key}>
                  <div className="feed-heading">
                    <h3>{shelf.title}</h3>
                    {shelf.items.length > 4 && <button className="text-button feed-more" aria-expanded={more}
                      onClick={() => setExpanded(current => more ? current.filter(id => id !== key) : [...current, key])}>
                      {more ? "Ver menos" : "Ver más"}
                    </button>}
                  </div>
                  <div className="feed-grid">
                    <AnimatePresence initial={false} mode="popLayout">
                      {items.map(item => <motion.button type="button" className="feed-card" key={item.id}
                        aria-label={item.track ? `Reproducir ${item.title}` : `Abrir ${item.title}`}
                        initial={{ opacity: 0, y: reduced ? 0 : 7 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: reduced ? 0 : 4, pointerEvents: "none", transition: { duration: 0.12 } }}
                        transition={{ duration: reduced ? 0.1 : 0.2, ease: settle }}
                        onClick={() => {
                          if (item.track) onPlay(queue, queue.findIndex(track => track.id === item.track?.id));
                          else if (item.link || item.artistId) onCollection(item);
                        }}>
                        <span className="feed-cover">{renderArt(item)}
                          <span className="feed-play" aria-hidden="true">
                            {item.track ? <Play fill="currentColor" size={15} /> : item.artistId ? <ArrowUpRight size={16} /> : <ChevronRight size={18} />}
                          </span>
                        </span>
                        <strong>{item.title}</strong>
                        {item.subtitle && <small>{item.subtitle}</small>}
                      </motion.button>)}
                    </AnimatePresence>
                  </div>
                </div>;
              })}
            </FeedSource>;
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
