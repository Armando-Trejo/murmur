import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDownUp, ArrowUpRight, ChevronDown, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { db } from "../core/db";
import { applyAlbumCover, forgetDeleted } from "../core/libraryEdit";
import { haptic } from "../core/haptics";
import {
  loadSort,
  playStats,
  rememberOpened,
  saveSort,
  type AlbumEntry,
  type ArtistEntry,
  type LibraryResults as Results,
  type PlayStats,
  type SortCategory,
  type SortOption,
} from "../core/librarySearch";
import { settle } from "../core/motion";
import type { Playlist, QueueItem } from "../core/types";
import { Cover } from "./Cover";
import { OverflowMenu } from "./OverflowMenu";

/* «Tu Biblioteca» (2.17): global search, per-category search and sort, shared by App and MusicDirectory. */

export const songsLabel = (count: number) => `${count.toLocaleString("es")} ${count === 1 ? "canción" : "canciones"}`;

/** The order chosen for a category, remembered in localStorage (murmur.sort.<category>). */
export function useSortPreference<T extends string>(category: SortCategory, options: readonly SortOption<T>[], fallback: T) {
  const [value, setValue] = useState<T>(() => loadSort(category, options, fallback));
  const choose = useCallback(
    (next: T) => {
      setValue(next);
      saveSort(category, next);
    },
    [category],
  );
  return [value, choose] as const;
}

/** The value after `delay` ms without changes; clearing it is immediate. */
export function useDebouncedValue(value: string, delay = 140) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (!value) {
      setSettled("");
      return;
    }
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return value ? settled : "";
}

const NO_STATS: PlayStats = new Map();
/**
 * Plays, seconds and last listen per song, read from the history once each time the library is
 * opened (not live, so lists never reshuffle under the finger while music plays).
 */
export function useListening(active: boolean): PlayStats {
  const [stats, setStats] = useState<PlayStats>(NO_STATS);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void db.history
      .toArray()
      .then((rows) => {
        if (live) setStats(playStats(rows));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [active]);
  return stats;
}

const OPENED_KEY = "murmur.library.opened";
function readOpened(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(OPENED_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
/** When each playlist was last opened, for «Recientes». Records `playlistId` whenever it opens. */
export function useOpenedPlaylists(playlistId: string | undefined) {
  const [opened, setOpened] = useState(readOpened);
  useEffect(() => {
    if (!playlistId) return;
    const next = rememberOpened(readOpened(), playlistId, Date.now());
    try {
      localStorage.setItem(OPENED_KEY, JSON.stringify(next));
    } catch {
      /* No storage: «Recientes» falls back to what was heard. */
    }
    setOpened(next);
  }, [playlistId]);
  return opened;
}

/** A saved album as is; an album known only from its songs is saved first, like the Álbumes view always did. */
export async function albumPlaylist(album: AlbumEntry): Promise<Playlist> {
  if (album.playlist) return album.playlist;
  const items = album.items ?? [];
  const playlist: Playlist = {
    id: album.key,
    title: album.title,
    kind: "album",
    source: "hybrid",
    trackIds: album.trackIds,
    artworkUrl: items.find((item) => item.artworkUrl)?.artworkUrl,
    addedAt: Date.now(),
    ...(album.artist ? { artist: album.artist } : {}),
  };
  await forgetDeleted(playlist.id);
  await db.playlists.put(playlist);
  await applyAlbumCover(playlist.id);
  return playlist;
}

/** "Ordenar: Recientes ▾" chip; the menu is the same popover as every other "Ordenar" in MURMUR. */
export function SortChip<T extends string>({
  noun,
  options,
  value,
  onChange,
}: {
  noun: string;
  options: readonly SortOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <OverflowMenu
      className="sort-chip"
      label={`Ordenar ${noun}: ${current.label}`}
      icon={
        <>
          <ArrowDownUp size={15} aria-hidden="true" />
          <span className="sort-chip-label">
            {/* Long names drop "Ordenar:" so the count beside them still fits on a phone. */}
            {current.short.length <= 10 && <span className="sort-chip-prefix">Ordenar: </span>}
            {current.short}
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </>
      }
      entries={[
        { heading: `Ordenar ${noun}` },
        ...options.map((option) => ({
          label: option.label,
          hint: option.hint,
          checked: option.value === value,
          onSelect: () => {
            if (option.value !== value) onChange(option.value);
          },
        })),
      ]}
    />
  );
}

/**
 * Sticky row over a category: how many there are, a search that filters the list in place and the
 * order. In the main library the search opens from the magnifier (the big search sits above); in
 * Artistas and Álbumes it is always open.
 */
export function LibraryToolbar({
  count,
  query,
  onQuery,
  placeholder,
  sort,
  resetKey,
  alwaysOpen = false,
}: {
  count: string;
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  sort: ReactNode;
  /** When it changes (a new order), the list returns to its start if it had scrolled past. */
  resetKey?: string;
  alwaysOpen?: boolean;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const lastKey = useRef(resetKey);
  const showField = alwaysOpen || open || !!query;
  useEffect(() => {
    const target = anchor.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 120),
      { rootMargin: "-88px 0px 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    // An instant jump: the list has just been reordered, there is nothing to travel past.
    const target = anchor.current;
    if (target && target.getBoundingClientRect().top < 90) target.scrollIntoView({ block: "start" });
  }, [resetKey]);
  const close = () => {
    if (query) {
      onQuery("");
      input.current?.focus({ preventScroll: true });
    } else if (!alwaysOpen) setOpen(false);
  };
  return (
    <>
      <div ref={anchor} className="library-toolbar-anchor" aria-hidden="true" />
      <div className={"library-toolbar" + (stuck ? " is-stuck" : "") + (showField ? " is-open" : "")}>
        <AnimatePresence initial={false} mode="popLayout">
          {showField ? (
            <motion.label
              key="field"
              className="library-filter"
              initial={{ opacity: 0, scale: reduced ? 1 : 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: reduced ? 0.1 : 0.22, ease: settle }}
            >
              <Search size={17} aria-hidden="true" />
              <input
                ref={input}
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                spellCheck={false}
                aria-label={placeholder}
                placeholder={placeholder}
                value={query}
                autoFocus={!alwaysOpen}
                onChange={(event) => onQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                  }
                }}
              />
              {(query || !alwaysOpen) && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={query ? "Limpiar búsqueda" : "Cerrar búsqueda"}
                  onClick={close}
                >
                  <X size={17} />
                </button>
              )}
            </motion.label>
          ) : (
            <motion.div
              key="count"
              className="library-toolbar-count"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: reduced ? 0.1 : 0.2, ease: settle }}
            >
              <span>{count}</span>
              <button
                type="button"
                className="icon-button library-filter-open"
                aria-label={placeholder}
                onClick={() => {
                  haptic();
                  setOpen(true);
                }}
              >
                <Search size={19} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {sort}
      </div>
    </>
  );
}

/** The search at the top of Tu Biblioteca. */
export function LibrarySearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label className={"library-search" + (value ? " is-active" : "")}>
      <Search size={19} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Buscar en tu biblioteca"
        placeholder="Buscar en tu biblioteca"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
      <AnimatePresence initial={false}>
        {value && (
          <motion.button
            type="button"
            className="icon-button"
            aria-label="Limpiar búsqueda"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: settle }}
            onClick={() => {
              onChange("");
              input.current?.focus({ preventScroll: true });
            }}
          >
            <X size={18} />
          </motion.button>
        )}
      </AnimatePresence>
    </label>
  );
}

type Group = "all" | "songs" | "albums" | "artists" | "playlists";
const groupTitles: Record<Exclude<Group, "all">, string> = {
  songs: "Canciones",
  albums: "Álbumes",
  artists: "Artistas",
  playlists: "Playlists",
};
const preview: Record<Exclude<Group, "all">, number> = { songs: 5, albums: 4, artists: 4, playlists: 4 };

/** Grouped results of the library search, with counts; each result opens like it does in its category. */
export function LibraryResults({
  query,
  results,
  renderSong,
  onAlbum,
  onArtist,
  onPlaylist,
  onSearchEverywhere,
}: {
  query: string;
  results: Results;
  renderSong: (track: QueueItem) => ReactNode;
  onAlbum: (album: AlbumEntry) => void;
  onArtist: (artist: ArtistEntry) => void;
  onPlaylist: (playlist: Playlist) => void;
  onSearchEverywhere: () => void;
}) {
  const reduced = useReducedMotion();
  const [chosen, setChosen] = useState<Group>("all");
  const [limit, setLimit] = useState(60);
  const groups = (Object.keys(groupTitles) as Exclude<Group, "all">[]).filter((key) => results[key].length);
  const group: Group = chosen !== "all" && !results[chosen].length ? "all" : chosen;
  useEffect(() => setLimit(60), [group, query]);
  const choose = (next: Group) => {
    haptic();
    setChosen(next);
    window.scrollTo({ top: 0 });
  };
  if (!results.total)
    return (
      <motion.div
        className="library-empty"
        role="status"
        initial={{ opacity: 0, y: reduced ? 0 : 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0.1 : 0.24, ease: settle }}
      >
        <Search size={30} aria-hidden="true" />
        <h2>No hay nada con «{query}» en tu biblioteca</h2>
        <p>Revisa cómo está escrito o búscalo en todo MURMUR.</p>
        <button type="button" className="button secondary" onClick={onSearchEverywhere}>
          Buscar en MURMUR
          <ArrowUpRight size={18} />
        </button>
      </motion.div>
    );
  const shown = group === "all" ? groups : [group];
  return (
    <div className="library-results" aria-live="polite">
      <div className="pills library-result-pills" role="group" aria-label="Filtrar resultados">
        <button type="button" className={group === "all" ? "active" : ""} aria-pressed={group === "all"} onClick={() => choose("all")}>
          Todo <span className="pill-count">{results.total.toLocaleString("es")}</span>
        </button>
        {groups.map((key) => (
          <button
            type="button"
            key={key}
            className={group === key ? "active" : ""}
            aria-pressed={group === key}
            onClick={() => choose(key)}
          >
            {groupTitles[key]} <span className="pill-count">{results[key].length.toLocaleString("es")}</span>
          </button>
        ))}
      </div>
      {results.fuzzy && <p className="collection-count">Sin coincidencias exactas. Esto se parece a «{query}».</p>}
      {shown.map((key) => {
        const all = results[key];
        const visible = group === "all" ? all.slice(0, preview[key]) : all.slice(0, limit);
        return (
          <section className="library-hits" key={key} aria-label={groupTitles[key]}>
            <div className="library-hits-head">
              <h2>{groupTitles[key]}</h2>
              <span className="library-hits-count">{all.length.toLocaleString("es")}</span>
              {group === "all" && all.length > preview[key] && (
                <button type="button" className="text-button" onClick={() => choose(key)}>
                  Ver todo
                </button>
              )}
            </div>
            {key === "songs" && (visible as QueueItem[]).map((track) => renderSong(track))}
            {key === "albums" &&
              (visible as AlbumEntry[]).map((album) => (
                <button type="button" className="playlist-row library-hit" key={album.key} onClick={() => onAlbum(album)}>
                  <Cover track={album.cover} size="small" />
                  <span>
                    <strong>{album.title}</strong>
                    <small>
                      Álbum{album.artist ? " · " + album.artist : ""} · {songsLabel(album.count)}
                    </small>
                  </span>
                </button>
              ))}
            {key === "artists" &&
              (visible as ArtistEntry[]).map((artist) => (
                <button type="button" className="playlist-row library-hit is-artist" key={artist.key} onClick={() => onArtist(artist)}>
                  <Cover track={artist.cover} size="small" />
                  <span>
                    <strong>{artist.name}</strong>
                    <small>Artista · {songsLabel(artist.count)}</small>
                  </span>
                </button>
              ))}
            {key === "playlists" &&
              (visible as Playlist[]).map((playlist) => (
                <button type="button" className="playlist-row library-hit" key={playlist.id} onClick={() => onPlaylist(playlist)}>
                  <Cover track={playlist} size="small" />
                  <span>
                    <strong>{playlist.title}</strong>
                    <small>Playlist · {songsLabel(playlist.trackIds.length)}</small>
                  </span>
                </button>
              ))}
            {group !== "all" && all.length > limit && (
              <button type="button" className="button secondary full" onClick={() => setLimit((value) => value + 60)}>
                Mostrar más · {limit} de {all.length.toLocaleString("es")}
              </button>
            )}
          </section>
        );
      })}
      <button type="button" className="text-button library-elsewhere" onClick={onSearchEverywhere}>
        Buscar «{query}» en todo MURMUR
        <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
