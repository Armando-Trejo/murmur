import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Play, Plus, RefreshCw, Sparkles } from "lucide-react";
import { cachedBlendMixes, generateBlendMixes, saveBlendMix, type BlendMix } from "../core/blendMixes";
import { settle } from "../core/motion";
import { haptic } from "../core/haptics";
import type { QueueItem } from "../core/types";
import { Cover } from "./Cover";

/**
 * "Mezclas MURMUR" on Home: playlists that join Spotify's and YouTube Music's recommendations with
 * what you play here. Shown from cache at once, refreshed in the background twice a day.
 */
export function BlendMixes({
  enabled,
  onPlay,
  notify,
}: {
  enabled: boolean;
  onPlay: (items: QueueItem[], index: number) => void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const reduced = useReducedMotion();
  const [mixes, setMixes] = useState<BlendMix[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const load = async (force: boolean) => {
    setLoading(true);
    try {
      const fresh = await generateBlendMixes(force);
      setMixes(fresh);
      if (force && !fresh.length) notify("Conecta Spotify o YouTube Music y escucha algunas canciones para crear tus mezclas.", "info");
    } catch {
      notify("No se pudieron crear las mezclas ahora. Reintenta en un momento.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void cachedBlendMixes().then((cached) => { if (live && cached?.mixes.length) setMixes(cached.mixes); });
    void load(false);
    return () => { live = false; };
  }, [enabled]);

  const keep = async (blendMix: BlendMix) => {
    haptic();
    try {
      await saveBlendMix(blendMix);
      setSaved((s) => new Set(s).add(blendMix.id));
      haptic("confirm");
      notify(`«${blendMix.title}» se guardó en tu biblioteca.`, "success");
    } catch {
      notify("No se pudo guardar la mezcla.", "error");
    }
  };

  if (!enabled || (!mixes.length && !loading)) return null;
  return (
    <section className="blend-mixes" aria-labelledby="blend-heading" aria-busy={loading}>
      <div className="feed-heading">
        <h2 id="blend-heading"><Sparkles size={19} aria-hidden="true" /> Mezclas MURMUR</h2>
        <button className="icon-button" aria-label="Crear mezclas nuevas" disabled={loading}
          onClick={() => { haptic(); void load(true); }}>
          <RefreshCw size={18} className={loading ? "spin" : undefined} />
        </button>
      </div>
      <p className="feed-note">Spotify y YouTube Music, mezclados a tu medida.</p>
      <div className="blend-row">
        {!mixes.length && loading
          ? [0, 1, 2].map((i) => <div className="blend-card is-skeleton" key={i}><span className="blend-art skeleton" /><span className="skeleton album-line" /></div>)
          : mixes.map((blendMix, index) => (
              <motion.article
                className="blend-card"
                key={blendMix.id}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, ease: settle, delay: reduced ? 0 : Math.min(index, 6) * 0.05 }}
              >
                <button className="blend-open" aria-label={"Reproducir " + blendMix.title}
                  onClick={() => { haptic(); onPlay(blendMix.tracks, 0); }}>
                  <span className={"blend-art covers-" + Math.min(blendMix.covers.length, 4)}>
                    {blendMix.covers.slice(0, 4).map((url) => <Cover key={url} track={{ artworkUrl: url }} />)}
                    <span className="blend-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
                  </span>
                  <strong>{blendMix.title}</strong>
                  <small>{blendMix.tracks.length} canciones · {blendMix.spotify} Spotify · {blendMix.youtube} YouTube</small>
                </button>
                <button
                  className={"album-save" + (saved.has(blendMix.id) ? " saved" : "")}
                  aria-label={saved.has(blendMix.id) ? "Mezcla guardada" : "Guardar " + blendMix.title + " en tu biblioteca"}
                  disabled={saved.has(blendMix.id)}
                  onClick={() => void keep(blendMix)}
                >
                  {saved.has(blendMix.id) ? <Check size={18} /> : <Plus size={19} />}
                </button>
              </motion.article>
            ))}
      </div>
    </section>
  );
}
