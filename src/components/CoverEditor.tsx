import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ImagePlus, RotateCcw, X } from "lucide-react";
import { settle } from "../core/motion";
import { haptic } from "../core/haptics";
import type { ArtworkFrame, CustomArtwork } from "../core/types";
import { Cover } from "./Cover";

const DEFAULT_FRAME: ArtworkFrame = { x: 50, y: 50, zoom: 1, fit: "cover" };
const MAX_SIDE = 640;

/** Reads a picked photo, keeps its centre square at 640 px and returns it as a compact JPEG. */
async function squareJpeg(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Elige una imagen (JPG, PNG o WebP).");
  if (file.size > 25 * 1024 * 1024) throw new Error("La imagen supera los 25 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(MAX_SIDE, side);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la imagen.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close();
  }
}

/**
 * Cover editor for a playlist, album or song: upload your own image, move and zoom the crop, or
 * show the whole picture; "Restaurar" goes back to the provider's cover. Everything stays on the
 * phone and survives Spotify/YouTube resyncs.
 */
export function CoverEditor({
  title,
  item,
  onSave,
  onClose,
  notify,
}: {
  title: string;
  item: CustomArtwork & { artworkUrl?: string; videoId?: string };
  onSave: (change: CustomArtwork) => Promise<void>;
  onClose: () => void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const reduced = useReducedMotion();
  const [custom, setCustom] = useState(item.customArtwork);
  const [frame, setFrame] = useState<ArtworkFrame>(item.artworkFrame ?? DEFAULT_FRAME);
  const [saving, setSaving] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; frame: ArtworkFrame } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    try {
      setCustom(await squareJpeg(file));
      setFrame(DEFAULT_FRAME);
      haptic("confirm");
    } catch (error) {
      notify((error as Error).message || "No se pudo leer la imagen.", "error");
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      const unchanged = frame.x === 50 && frame.y === 50 && frame.zoom === 1 && frame.fit === "cover";
      await onSave({ customArtwork: custom, artworkFrame: unchanged ? undefined : frame });
      haptic("confirm");
      notify("Carátula guardada.", "success");
      onClose();
    } catch {
      notify("No se pudo guardar la carátula.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={"Carátula de " + title}
        className="action-sheet cover-editor"
        initial={{ y: reduced ? 0 : 40, opacity: reduced ? 1 : 0.7 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: reduced ? 0.1 : 0.3, ease: settle }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cover-editor-head">
          <strong>Carátula</strong>
          <button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={20} /></button>
        </div>
        <div
          ref={stage}
          className="cover-editor-stage"
          aria-label="Arrastra para mover el encuadre"
          onPointerDown={(event) => {
            drag.current = { x: event.clientX, y: event.clientY, frame };
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            const box = stage.current?.getBoundingClientRect();
            if (!start || !box) return;
            // Dragging right reveals more of the left side: the focal point moves the other way.
            const factor = 100 / box.width / Math.max(1, start.frame.zoom - 0.6);
            setFrame({
              ...start.frame,
              x: Math.max(0, Math.min(100, start.frame.x - (event.clientX - start.x) * factor)),
              y: Math.max(0, Math.min(100, start.frame.y - (event.clientY - start.y) * factor)),
            });
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        >
          <Cover track={{ artworkUrl: item.artworkUrl, videoId: item.videoId, customArtwork: custom, artworkFrame: frame }} large />
          <span className="cover-editor-grid" aria-hidden="true" />
        </div>
        <p className="cover-editor-title">{title}</p>
        <div className="segmented cover-editor-fit" role="group" aria-label="Encuadre">
          {(["cover", "contain"] as const).map((fit) => (
            <button key={fit} className={frame.fit === fit ? "active" : ""} aria-pressed={frame.fit === fit}
              onClick={() => setFrame({ ...frame, fit })}>
              {fit === "cover" ? "Recortar" : "Completa"}
            </button>
          ))}
        </div>
        <label className="cover-editor-zoom">
          <span>Zoom</span>
          <input type="range" min="1" max="3" step="0.01" value={frame.zoom}
            onChange={(e) => setFrame({ ...frame, zoom: Number(e.target.value) })} />
        </label>
        <div className="cover-editor-actions">
          <button className="button secondary" onClick={() => picker.current?.click()}>
            <ImagePlus size={18} /> Subir imagen
          </button>
          <button className="button secondary" disabled={!custom && !item.artworkFrame && frame === DEFAULT_FRAME}
            onClick={() => { setCustom(undefined); setFrame(DEFAULT_FRAME); }}>
            <RotateCcw size={18} /> Restaurar
          </button>
        </div>
        <button className="button primary full" disabled={saving} onClick={() => void save()}>
          {saving ? "Guardando…" : "Guardar carátula"}
        </button>
        <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </motion.div>
    </motion.div>
  );
}
