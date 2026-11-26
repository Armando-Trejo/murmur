import { motion, useReducedMotion } from "framer-motion";
import { Check, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { db, playlistTracks } from "../core/db";
import { haptic } from "../core/haptics";
import { normalize } from "../core/FanUploadParser";
import {
  addSongs, createCollection, deleteCollection, deleteSong, editCollection, editSong, unlikeCollection,
} from "../core/libraryEdit";
import { settle } from "../core/motion";
import type { Playlist, QueueItem } from "../core/types";
import { Cover } from "./Cover";

export type EditorTarget =
  | { type: "new"; kind: "playlist" | "album" }
  | { type: "collection"; id: string }
  | { type: "add"; id: string }
  | { type: "delete-collection"; id: string }
  | { type: "unlike"; id: string; count: number }
  | { type: "song"; id: string }
  | { type: "delete-song"; id: string };

const SHOWN = 60;

/** The library's forms and confirmations, as a bottom sheet. */
export function LibraryEditor({
  target,
  onClose,
  notify,
  onCreated,
  onDeletedCollection,
}: {
  target: EditorTarget;
  onClose: () => void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
  onCreated: (playlist: Playlist) => void;
  onDeletedCollection: () => void;
}) {
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const id = "id" in target ? target.id : "";
  const forSong = target.type === "song" || target.type === "delete-song";
  const playlist = useLiveQuery(async () => (!forSong && id ? db.playlists.get(id) : undefined), [id, forSong]);
  const song = useLiveQuery(async () => (forSong ? db.tracks.get(id) : undefined), [id, forSong]);

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      haptic("confirm");
      if (done) notify(done, "success");
      onClose();
    } catch (error) {
      notify((error as Error).message || "No se pudo guardar el cambio.", "error");
      setBusy(false);
    }
  };

  const kind = target.type === "new" ? target.kind : playlist?.kind === "album" ? "album" : "playlist";
  const noun = kind === "album" ? "álbum" : "playlist";

  let title = "";
  let body: ReactNode = null;
  if (target.type === "new" || (target.type === "collection" && playlist)) {
    title = target.type === "new" ? (kind === "album" ? "Nuevo álbum" : "Nueva playlist") : "Editar " + noun;
    body = (
      <Form
        key={playlist?.id ?? "new"}
        busy={busy}
        submit={target.type === "new" ? "Crear " + noun : "Guardar cambios"}
        fields={[
          { name: "title", label: kind === "album" ? "Nombre del álbum" : "Nombre de la playlist", value: playlist?.title ?? "", required: true },
          ...(kind === "album"
            ? [{ name: "artist", label: "Artista", value: playlist?.artist ?? "" }, { name: "year", label: "Año", value: playlist?.year ?? "", numeric: true }]
            : []),
        ]}
        onSubmit={(v) =>
          void run(async () => {
            const draft = { title: v.title, artist: v.artist, year: v.year };
            if (target.type === "new") onCreated(await createCollection(kind, draft));
            else await editCollection(id, draft);
          }, target.type === "new" ? (kind === "album" ? "Álbum creado" : "Playlist creada") : "Cambios guardados")
        }
      />
    );
  } else if (target.type === "song" && song) {
    title = "Editar canción";
    body = (
      <Form
        key={song.id}
        busy={busy}
        submit="Guardar cambios"
        fields={[
          { name: "title", label: "Título", value: song.title, required: true },
          { name: "artist", label: "Artista", value: song.artist, required: true },
          { name: "album", label: "Álbum", value: song.album ?? "" },
        ]}
        onSubmit={(v) => void run(() => editSong(id, { title: v.title, artist: v.artist, album: v.album }), "Canción actualizada")}
      />
    );
  } else if (target.type === "add" && playlist) {
    title = "Añadir canciones";
    body = <AddSongs playlist={playlist} busy={busy} onAdd={(songs) => void run(() => addSongs(id, songs),
      songs.length === 1 ? "1 canción añadida" : `${songs.length} canciones añadidas`)} />;
  } else if (target.type === "delete-collection" && playlist) {
    title = `¿Eliminar ${kind === "album" ? "el álbum" : "la playlist"} «${playlist.title}»?`;
    body = (
      <Confirm busy={busy} label={"Eliminar " + noun} onCancel={onClose}
        text={`Se quita de MURMUR. Sus canciones en Guardadas se quedan ahí${playlist.source === "hybrid" ? "" : " y en Spotify o YouTube no cambia nada"}.`}
        onConfirm={() => void run(async () => { await deleteCollection(id); onDeletedCollection(); }, kind === "album" ? "Álbum eliminado" : "Playlist eliminada")} />
    );
  } else if (target.type === "unlike") {
    title = "¿Quitar de Guardadas?";
    body = (
      <Confirm busy={busy} label={`Quitar ${target.count} de Guardadas`} onCancel={onClose}
        text={`Las canciones siguen en «${playlist?.title ?? ""}»; solo dejan de estar en Guardadas. Después puedes marcar con ♥ las que quieras.`}
        onConfirm={() => void run(() => unlikeCollection(id), "Listo: ya no están en Guardadas")} />
    );
  } else if (target.type === "delete-song" && song) {
    title = `¿Eliminar «${song.title}»?`;
    body = (
      <Confirm busy={busy} label="Eliminar canción" onCancel={onClose}
        text={`Sale de Guardadas, de tus playlists y álbumes${song.offlinePath ? " y se borra su descarga" : ""}. En Spotify o YouTube no cambia nada.`}
        onConfirm={() => void run(() => deleteSong(id), "Canción eliminada")} />
    );
  }

  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, pointerEvents: "none" }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title || "Biblioteca"}
        className="action-sheet library-editor"
        initial={{ y: reduced ? 0 : 40, opacity: reduced ? 1 : 0.7 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: reduced ? 0.1 : 0.3, ease: settle }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cover-editor-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={20} /></button>
        </div>
        {body}
      </motion.div>
    </motion.div>
  );
}

interface Field { name: string; label: string; value: string; required?: boolean; numeric?: boolean }

function Form({ fields, submit, busy, onSubmit }: { fields: Field[]; submit: string; busy: boolean; onSubmit: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.value])));
  const ready = fields.every((f) => !f.required || values[f.name]?.trim());
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !busy) onSubmit(values);
  };
  return (
    <form onSubmit={send}>
      {fields.map((f, i) => (
        <label key={f.name}>
          {f.label}
          <input
            autoFocus={i === 0 && !f.value}
            value={values[f.name] ?? ""}
            maxLength={f.numeric ? 4 : 200}
            inputMode={f.numeric ? "numeric" : undefined}
            enterKeyHint="done"
            onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
          />
        </label>
      ))}
      <button className="button primary full" disabled={!ready || busy}>{busy ? "Guardando…" : submit}</button>
    </form>
  );
}

function Confirm({ text, label, busy, onConfirm, onCancel }: { text: string; label: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <>
      <p className="help-copy">{text}</p>
      <button className="button primary full danger-button" disabled={busy} onClick={onConfirm}>{busy ? "Un momento…" : label}</button>
      <button className="button secondary full" onClick={onCancel}>Cancelar</button>
    </>
  );
}

/** Songs of the library (never new ones), searchable, several at once. */
function AddSongs({ playlist, busy, onAdd }: { playlist: Playlist; busy: boolean; onAdd: (songs: QueueItem[]) => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Map<string, QueueItem>>(new Map());
  const [present, setPresent] = useState<Set<string>>();
  const songs = useLiveQuery(() => db.tracks.filter((t) => !t.deleted).toArray(), [], [] as QueueItem[]);
  useEffect(() => {
    void playlistTracks(playlist).then((items) => setPresent(new Set(items.map((t) => t.id))));
  }, [playlist]);
  const matches = useMemo(() => {
    const words = normalize(query).split(" ").filter(Boolean);
    // An album first suggests the songs of its own artist; liked songs go before the rest.
    const artist = normalize(playlist.artist ?? "");
    const rank = (t: QueueItem) => (artist && normalize(t.artist).includes(artist) ? 2 : 0) + (t.saved !== false ? 1 : 0);
    return songs
      .filter((t) => present && !present.has(t.id))
      .filter((t) => { const text = normalize(`${t.title} ${t.artist} ${t.album ?? ""}`); return words.every((w) => text.includes(w)); })
      .sort((a, b) => rank(b) - rank(a) || (b.addedAt ?? 0) - (a.addedAt ?? 0));
  }, [songs, present, query, playlist.artist]);
  const toggle = (song: QueueItem) => {
    haptic();
    const next = new Map(picked);
    if (!next.delete(song.id)) next.set(song.id, song);
    setPicked(next);
  };
  return (
    <>
      <input type="search" className="library-editor-search" enterKeyHint="search" aria-label="Buscar en tu biblioteca"
        placeholder="Buscar en tu biblioteca" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="library-editor-list">
        {matches.slice(0, SHOWN).map((t) => (
          <button key={t.id} type="button" className={"library-editor-song" + (picked.has(t.id) ? " picked" : "")}
            aria-pressed={picked.has(t.id)} onClick={() => toggle(t)}>
            <Cover track={t} size="small" />
            <span><strong>{t.title}</strong><small>{t.artist}</small></span>
            <i aria-hidden="true">{picked.has(t.id) && <Check size={15} />}</i>
          </button>
        ))}
        {present && !matches.length && <p className="help-copy">No hay canciones de tu biblioteca que coincidan.</p>}
        {matches.length > SHOWN && <p className="help-copy">Escribe para afinar: hay {matches.length.toLocaleString("es")} canciones.</p>}
      </div>
      <button className="button primary full" disabled={!picked.size || busy} onClick={() => onAdd([...picked.values()])}>
        {!picked.size ? "Elige canciones" : picked.size === 1 ? "Añadir 1 canción" : `Añadir ${picked.size} canciones`}
      </button>
    </>
  );
}
