import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Play, Search, Shuffle } from "lucide-react";
import { Audio, Auth, isNative, type ArtistPage, type FeedItem } from "../native";
import { searchAll } from "../core/DiscoveryEngine";
import { orderMusic, type ListeningStats } from "../core/musicOrder";
import { sizedArtwork, artworkFor } from "../core/artwork";
import { settle } from "../core/motion";
import { normalize } from "../core/FanUploadParser";
import type { QueueItem } from "../core/types";
import { useArtworkTone } from "./PlayerBackdrop";
import { Cover } from "./Cover";
import { OverflowMenu } from "./OverflowMenu";

const songShelf = /^(?:canciones|songs|top songs|populares|lo más popular)/i;

function sameArtist(track: QueueItem, name: string) {
  const wanted = normalize(name);
  return track.artist.split(/\s*(?:,|&)\s*/).some((artist) => normalize(artist) === wanted);
}

/**
 * Premium artist page: hero photo tinted with its own colour, popular songs from the provider,
 * the user's own tracks, then albums, singles, videos and related artists as carousels.
 */
export function ArtistProfile({
  name,
  artistId,
  library,
  stats,
  onPlay,
  onShuffle,
  onCollection,
  onArtist,
  onSearch,
  renderSong,
}: {
  name: string;
  artistId?: string;
  library: QueueItem[];
  stats: ListeningStats;
  onPlay: (items: QueueItem[], index: number) => void;
  onShuffle: (items: QueueItem[]) => void;
  onCollection: (item: FeedItem) => void;
  onArtist: (name: string, id?: string) => void;
  onSearch: (query: string) => void;
  renderSong: (track: QueueItem, index: number, list: QueueItem[]) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const [page, setPage] = useState<{ key: string; data?: ArtistPage; error?: string }>();
  const [found, setFound] = useState<{ key: string; items: QueueItem[] }>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const key = artistId || name;
  useEffect(() => {
    let live = true;
    setAboutOpen(false);
    if (!isNative) return;
    setPage({ key });
    void Auth.youtubeArtist(artistId ? { id: artistId } : { name })
      .then((data) => { if (live) setPage({ key, data }); })
      .catch((error: Error) => { if (live) setPage({ key, error: error.message }); });
    return () => { live = false; };
  }, [key]);
  const data = page?.key === key ? page.data : undefined;
  const loading = isNative && (!page || page.key !== key || (!page.data && !page.error));
  const title = data?.name || name;
  const shelves = data?.shelves ?? [];
  const popularShelf = shelves.find((shelf) => songShelf.test(shelf.title) && shelf.items.some((item) => item.track));
  const popular = useMemo(
    () => (popularShelf?.items ?? []).flatMap((item) => (item.track ? [item.track] : [])).slice(0, 10),
    [popularShelf],
  );
  // Without a provider song list, fall back to a search filtered to this artist.
  useEffect(() => {
    if (loading || popular.length || !navigator.onLine) return;
    let live = true;
    void searchAll(title, "all")
      .then((items) => { if (live) setFound({ key, items: items.filter((t) => sameArtist(t, title)).slice(0, 10) }); })
      .catch(() => {});
    return () => { live = false; };
  }, [loading, popular.length, key]);
  const searched = found?.key === key ? found.items : [];
  const top = popular.length ? popular : searched;
  const mine = useMemo(
    () => orderMusic(library.filter((track) => sameArtist(track, title)), "listening", stats),
    [library, title, stats],
  );
  const plays = mine.reduce((sum, track) => sum + (stats[track.id]?.plays ?? 0), 0);
  const hero = data?.artworkUrl ? sizedArtwork(data.artworkUrl, 1200) : artworkFor(mine[0] ?? top[0]);
  const tone = useArtworkTone(hero);
  const playable = top.length ? top : mine;
  const carousels = shelves.filter((shelf) => shelf !== popularShelf && shelf.items.length);
  const facts = [data?.audience, mine.length ? `${mine.length} en tu biblioteca` : "", plays ? `${plays} reproducciones tuyas` : ""]
    .filter(Boolean);
  return (
    <section className="artist-profile" style={tone ? ({ "--tone": tone } as CSSProperties) : undefined}>
      <header className={"artist-hero" + (hero ? " has-photo" : "")}>
        {hero && (
          <motion.img
            className="artist-photo"
            src={hero}
            alt=""
            referrerPolicy="no-referrer"
            initial={{ opacity: 0, scale: reduced ? 1 : 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduced ? 0.1 : 0.7, ease: settle }}
          />
        )}
        <motion.div
          className="artist-hero-copy"
          initial={{ opacity: 0, y: reduced ? 0 : 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.1 : 0.45, ease: settle, delay: reduced ? 0 : 0.08 }}
        >
          <span className="eyebrow">Artista</span>
          <h1>{title}</h1>
          {facts.length > 0 && <p>{facts.join(" · ")}</p>}
        </motion.div>
      </header>
      <div className="profile-actions">
        <motion.button
          whileTap={{ scale: 0.95 }}
          className="button primary"
          disabled={!playable.length}
          onClick={() => onPlay(playable, 0)}
        >
          <Play size={19} fill="currentColor" /> Reproducir
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.92 }}
          className="icon-button round-action"
          aria-label={"Reproducir " + title + " en aleatorio"}
          disabled={!playable.length}
          onClick={() => onShuffle([...playable, ...mine.filter((t) => !playable.some((p) => p.id === t.id))])}
        >
          <Shuffle size={21} />
        </motion.button>
        <OverflowMenu
          label={"Más opciones de " + title}
          entries={[
            ...(data?.id && isNative
              ? [{ label: "Abrir en YouTube Music", icon: <ArrowUpRight size={18} />, onSelect: () => void Audio.openYouTubeArtist({ id: data.id }).catch(() => {}) }]
              : []),
            { label: "Buscar todo de " + title, icon: <Search size={18} />, onSelect: () => onSearch(title) },
          ]}
        />
      </div>
      {data?.description && (
        <button className={"artist-about" + (aboutOpen ? " open" : "")} aria-expanded={aboutOpen} onClick={() => setAboutOpen((v) => !v)}>
          <span>{data.description}</span>
          <small>{aboutOpen ? "Mostrar menos" : "Leer más"}</small>
        </button>
      )}
      <h2 className="profile-heading">Populares</h2>
      {loading && !top.length ? (
        <div className="skeleton-list" aria-label="Cargando canciones populares">
          {[0, 1, 2, 3, 4].map((i) => <div className="skeleton" key={i} />)}
        </div>
      ) : top.length ? (
        <ol className="profile-songs">
          {top.slice(0, 5).map((track, index) => (
            <li key={track.id}>
              <span className="track-rank" aria-hidden="true">{index + 1}</span>
              {renderSong(track, index, top)}
            </li>
          ))}
        </ol>
      ) : (
        <p className="help-copy">{page?.error || "Aún no hay canciones populares disponibles para este artista."}</p>
      )}
      {mine.length > 0 && (
        <>
          <h2 className="profile-heading">En tu biblioteca</h2>
          {mine.slice(0, 8).map((track, index) => renderSong(track, index, mine))}
        </>
      )}
      {carousels.map((shelf) => (
        <section className="profile-shelf" key={shelf.title}>
          <h2 className="profile-heading">{shelf.title}</h2>
          <div className="profile-carousel">
            {shelf.items.slice(0, 16).map((item, index) => (
              <motion.button
                key={item.id}
                whileTap={{ scale: 0.96 }}
                className={"profile-card" + (item.artistId ? " is-artist" : "")}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "40px" }}
                transition={{ duration: 0.32, ease: settle, delay: reduced ? 0 : Math.min(index, 6) * 0.04 }}
                onClick={() => {
                  if (item.artistId) onArtist(item.title, item.artistId);
                  else if (item.track) onPlay([item.track], 0);
                  else onCollection(item);
                }}
              >
                <Cover track={item.track ?? { artworkUrl: item.artworkUrl }} />
                <strong>{item.title}</strong>
                {item.subtitle && <small>{item.subtitle}</small>}
              </motion.button>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
