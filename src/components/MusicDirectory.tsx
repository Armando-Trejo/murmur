import { useEffect, useMemo, useState } from "react";
import { searchAll } from "../core/DiscoveryEngine";
import {
  ALBUM_SORTS,
  ARTIST_SORTS,
  albumIndexer,
  artistIndexer,
  artistNames,
  collectAlbums,
  collectArtists,
  filterItems,
  fold,
  sortAlbums,
  sortArtists,
  type AlbumEntry,
  type ArtistEntry,
  type PlayStats,
} from "../core/librarySearch";
import { orderMusic } from "../core/musicOrder";
import type { Playlist, QueueItem } from "../core/types";
import { Cover } from "./Cover";
import { LibraryToolbar, SortChip, albumPlaylist, songsLabel, useDebouncedValue, useSortPreference } from "./LibraryTools";

const PAGE = 120;
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("es")} ${count === 1 ? one : many}`;

/** Artistas and Álbumes of Tu Biblioteca: a search that filters in place and an order that is remembered. */
export function MusicDirectory({
  artist,
  mode,
  tracks,
  playlists,
  albums,
  artists,
  stats,
  ranks,
  onArtist,
  onAlbum,
  onPlay,
  onBack,
}: {
  artist?: string;
  mode?: "artists" | "albums";
  /** The songs of the library. */
  tracks: QueueItem[];
  playlists: Playlist[];
  /** Already collected by the caller (computed here when missing). */
  albums?: AlbumEntry[];
  artists?: ArtistEntry[];
  /** Plays per song, for «Más escuchados». */
  stats?: PlayStats;
  /** Song id → rank in «Agregados recientemente». */
  ranks?: Map<string, number>;
  onArtist: (name: string) => void;
  onAlbum: (p: Playlist) => void;
  onPlay: (tracks: QueueItem[], index: number) => void;
  onBack: () => void;
}) {
  const [online, setOnline] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setOnline([]);
    setError("");
    if (artist) {
      setLoading(true);
      void searchAll(artist, "all")
        .then((items) => {
          if (live) setOnline(items);
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }
    return () => {
      live = false;
    };
  }, [artist]);

  const [query, setQuery] = useState("");
  const text = useDebouncedValue(query.trim(), 120);
  const [visible, setVisible] = useState(PAGE);
  const [artistSort, setArtistSort] = useSortPreference("artists", ARTIST_SORTS, "most-played");
  const [albumSort, setAlbumSort] = useSortPreference("albums", ALBUM_SORTS, "recent");
  useEffect(() => setQuery(""), [mode, artist]);
  useEffect(() => setVisible(PAGE), [mode, artist, text, artistSort, albumSort]);

  const local = useMemo(
    () => (artist ? tracks.filter((t) => artistNames(t.artist).some((name) => fold(name) === fold(artist))) : tracks),
    [artist, tracks],
  );
  const artistList = useMemo(
    () => (mode === "artists" && !artist ? artists ?? collectArtists(tracks) : []),
    [mode, artist, artists, tracks],
  );
  const albumList = useMemo(() => {
    if (artist) {
      const ids = new Set(local.map((t) => t.id));
      return collectAlbums(local, playlists).filter((album) => album.trackIds.some((id) => ids.has(id)));
    }
    return mode === "albums" ? albums ?? collectAlbums(tracks, playlists) : [];
  }, [artist, mode, albums, local, tracks, playlists]);
  const artistIndex = useMemo(() => artistIndexer(), []);
  const albumIndex = useMemo(() => albumIndexer(), []);
  const shownArtists = useMemo(
    () => filterItems(artistIndex(sortArtists(artistList, artistSort, stats)), text),
    [artistIndex, artistList, artistSort, stats, text],
  );
  const shownAlbums = useMemo(
    () => filterItems(albumIndex(artist ? albumList : sortAlbums(albumList, albumSort, { stats, ranks })), artist ? "" : text),
    [albumIndex, albumList, albumSort, stats, ranks, text, artist],
  );
  const relevant = useMemo(
    () =>
      artist
        ? [...new Map([...orderMusic(local, "popular"), ...online].map((t) => [t.id, t])).values()].slice(0, 30)
        : [],
    [artist, local, online],
  );

  const openAlbum = (album: AlbumEntry) => {
    void albumPlaylist(album)
      .then(onAlbum)
      .catch(() => {});
  };
  const countLine = (shown: number, total: number, fuzzy: boolean, one: string, many: string) =>
    !text
      ? plural(total, one, many)
      : fuzzy
        ? `Sin coincidencias exactas · ${plural(shown, "parecido", "parecidos")} a «${text}»`
        : `${shown.toLocaleString("es")} de ${plural(total, one, many)}`;
  const albumButton = (album: AlbumEntry) => (
    <button key={album.key} onClick={() => openAlbum(album)}>
      <Cover track={album.cover} />
      <strong>{album.title}</strong>
      <small>{[album.artist, songsLabel(album.count)].filter(Boolean).join(" · ")}</small>
    </button>
  );
  const more = (total: number) =>
    total > visible && (
      <button className="button secondary full" onClick={() => setVisible((n) => n + PAGE)}>
        Mostrar más · {visible} de {total.toLocaleString("es")}
      </button>
    );

  return (
    <section className="music-directory">
      <button className="text-button" onClick={onBack}>
        Volver a Tu Biblioteca
      </button>
      <h1>{artist || (mode === "artists" ? "Artistas" : "Álbumes")}</h1>
      {!artist && mode === "artists" ? (
        <>
          <LibraryToolbar
            alwaysOpen
            count={plural(artistList.length, "artista", "artistas")}
            query={query}
            onQuery={setQuery}
            placeholder="Buscar artistas"
            resetKey={artistSort}
            sort={<SortChip noun="artistas" options={ARTIST_SORTS} value={artistSort} onChange={setArtistSort} />}
          />
          {artistList.length > 0 && (
            <p className="collection-count" role="status">
              {shownArtists.items.length || !text
                ? countLine(shownArtists.items.length, artistList.length, shownArtists.fuzzy, "artista", "artistas")
                : `Ningún artista coincide con «${text}».`}
            </p>
          )}
          <div className="directory-grid is-artists">
            {shownArtists.items.slice(0, visible).map((entry) => (
              <button key={entry.key} onClick={() => onArtist(entry.name)}>
                <Cover track={entry.cover} />
                <strong>{entry.name}</strong>
                <small>{songsLabel(entry.count)}</small>
              </button>
            ))}
          </div>
          {more(shownArtists.items.length)}
          {!artistList.length && <p>Importa música para organizar tus artistas.</p>}
        </>
      ) : !artist ? (
        <>
          <LibraryToolbar
            alwaysOpen
            count={plural(albumList.length, "álbum", "álbumes")}
            query={query}
            onQuery={setQuery}
            placeholder="Buscar álbumes"
            resetKey={albumSort}
            sort={<SortChip noun="álbumes" options={ALBUM_SORTS} value={albumSort} onChange={setAlbumSort} />}
          />
          {albumList.length > 0 && (
            <p className="collection-count" role="status">
              {shownAlbums.items.length || !text
                ? countLine(shownAlbums.items.length, albumList.length, shownAlbums.fuzzy, "álbum", "álbumes")
                : `Ningún álbum coincide con «${text}».`}
            </p>
          )}
          <div className="directory-grid">{shownAlbums.items.slice(0, visible).map(albumButton)}</div>
          {more(shownAlbums.items.length)}
          {!albumList.length && <p>Los álbumes aparecerán al importar enlaces o música con datos de álbum.</p>}
        </>
      ) : (
        <>
          <h2>Álbumes en tu biblioteca</h2>
          <div className="directory-grid">{shownAlbums.items.map(albumButton)}</div>
          {!albumList.length && <p>Los álbumes aparecerán al importar enlaces o música con datos de álbum.</p>}
          <h2>Lo más relevante</h2>
          <p className="help-copy">Tu biblioteca y resultados disponibles de los proveedores.</p>
          {loading && <p role="status">Buscando más música…</p>}
          {error && <p role="status">{error}</p>}
          {relevant.map((t, index) => (
            <button className="directory-song" key={t.id} onClick={() => onPlay(relevant, index)}>
              <Cover track={t} />
              <span>
                <strong>{t.title}</strong>
                <small>
                  {t.artist} · {t.source === "spotify" ? "Spotify" : "YouTube"}
                </small>
              </span>
            </button>
          ))}
        </>
      )}
    </section>
  );
}
