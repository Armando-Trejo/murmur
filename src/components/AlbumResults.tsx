import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Disc3, Plus, Loader2 } from "lucide-react";
import { searchAlbums, type AlbumResult } from "../core/albumSearch";
import { readCollectionLink, saveCollection } from "../core/CollectionImport";
import { settle } from "../core/motion";
import { haptic } from "../core/haptics";
import { Cover } from "./Cover";

/**
 * Whole-album search across YouTube Music and Spotify. "grid" is the Álbumes filter; "strip" is the
 * row shown above song results in Todo. The + saves the complete album to the library in one tap.
 */
export function AlbumResults({
  query,
  variant,
  savedIds,
  onOpen,
  notify,
}: {
  query: string;
  variant: "grid" | "strip";
  savedIds: Set<string>;
  onOpen: (album: AlbumResult) => void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<{ key: string; albums?: AlbumResult[]; failed?: string[]; error?: string }>();
  const [saving, setSaving] = useState<string>();
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());
  const key = query.trim();

  useEffect(() => {
    if (key.length < 2) return;
    let live = true;
    setState({ key });
    const timer = setTimeout(() => {
      void searchAlbums(key)
        .then((r) => live && setState({ key, albums: r.albums, failed: r.failed }))
        .catch((e: Error) => live && setState({ key, error: e.message }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  const save = async (album: AlbumResult) => {
    if (saving) return;
    haptic();
    setSaving(album.feedId);
    try {
      await saveCollection(await readCollectionLink(album.link));
      setJustSaved((s) => new Set(s).add(album.libraryId));
      haptic("confirm");
      notify(`«${album.title}» está en tu biblioteca.`, "success");
    } catch (e) {
      notify((e as Error).message || "No se pudo guardar el álbum.", "error");
    } finally {
      setSaving(undefined);
    }
  };

  const current = state?.key === key ? state : undefined;
  const albums = current?.albums ?? [];
  const loading = key.length >= 2 && (!current || (!current.albums && !current.error));

  if (variant === "strip" && !loading && !albums.length) return null;

  return (
    <section className={"album-results " + variant} aria-label="Álbumes" aria-busy={loading}>
      {variant === "strip" && (
        <div className="section-heading">
          <h2>Álbumes</h2>
        </div>
      )}
      {loading ? (
        <div className="album-grid" aria-hidden="true">
          {Array.from({ length: variant === "strip" ? 3 : 6 }, (_, i) => (
            <div className="album-card is-skeleton" key={i}>
              <div className="album-art skeleton" />
              <div className="skeleton album-line" />
            </div>
          ))}
        </div>
      ) : current?.error ? (
        <p className="help-copy">{current.error}</p>
      ) : albums.length ? (
        <div className="album-grid">
          {albums.slice(0, variant === "strip" ? 10 : 24).map((album, index) => {
            const saved = savedIds.has(album.libraryId) || justSaved.has(album.libraryId);
            return (
              <motion.div
                className="album-card"
                key={album.feedId}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: settle, delay: reduced ? 0 : Math.min(index, 8) * 0.035 }}
              >
                <button className="album-open" onClick={() => onOpen(album)}>
                  <span className="album-art">
                    <Cover track={{ artworkUrl: album.artworkUrl }} />
                  </span>
                  <strong>{album.title}</strong>
                  <small>
                    {[album.artist, album.year].filter(Boolean).join(" · ")}
                  </small>
                  <span className={"album-source " + album.source}>
                    {album.source === "spotify" ? "Spotify" : "YouTube Music"}
                  </span>
                </button>
                <button
                  className={"album-save" + (saved ? " saved" : "")}
                  aria-label={saved ? `«${album.title}» ya está en tu biblioteca` : `Guardar «${album.title}» en tu biblioteca`}
                  disabled={saved || saving === album.feedId}
                  onClick={() => void save(album)}
                >
                  {saving === album.feedId ? <Loader2 size={18} className="spin" /> : saved ? <Check size={18} /> : <Plus size={19} />}
                </button>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <Disc3 />
          <h2>Sin álbumes</h2>
          <p>Prueba con el nombre del álbum o del artista.</p>
        </div>
      )}
      {variant === "grid" && !!current?.failed?.length && albums.length > 0 && (
        <p className="help-copy album-partial">
          Sin resultados de {current.failed.join(" y ")}
          {current.failed.includes("Spotify") ? ": conecta tu cuenta en Opciones (⋯)." : "."}
        </p>
      )}
    </section>
  );
}
