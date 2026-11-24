import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { db } from "../core/db";
import { AUTO_PREFIX, DAILY_ID, WEEKLY_ID, refreshAutoMixes } from "../core/autoMixes";
import { settle } from "../core/motion";
import { haptic } from "../core/haptics";
import type { Playlist } from "../core/types";
import { Cover } from "./Cover";

/** Order on Home: the two discoveries first, then the blends. */
const rank = (p: Playlist) => (p.id === DAILY_ID ? 0 : p.id === WEEKLY_ID ? 1 : 2);

/**
 * "Hecho para ti" on Home. Every card OPENS its playlist (songs, play, shuffle, search inside);
 * nothing starts playing from a tap here. The playlists renew themselves: on opening MURMUR and
 * every 30 minutes while it is open, whatever is due (day, week, half-day) is rebuilt.
 */
export function MadeForYou({
  enabled,
  onOpen,
  notify,
}: {
  enabled: boolean;
  onOpen: (playlistId: string) => void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const playlists = useLiveQuery(
    async () => (await db.playlists.toArray()).filter((p) => p.id.startsWith(AUTO_PREFIX) && p.trackIds.length),
    [],
    [] as Playlist[],
  );
  const covers = useLiveQuery(async () => {
    const result: Record<string, string[]> = {};
    for (const p of playlists) {
      const tracks = await db.tracks.bulkGet(p.trackIds.slice(0, 12));
      result[p.id] = [...new Set(tracks.map((t) => t?.artworkUrl).filter((u): u is string => !!u))].slice(0, 4);
    }
    return result;
  }, [playlists], {} as Record<string, string[]>);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => void refreshAutoMixes(false).catch(() => {});
    tick();
    const timer = setInterval(tick, 30 * 60_000);
    return () => clearInterval(timer);
  }, [enabled]);

  const refresh = async () => {
    haptic();
    setBusy(true);
    try {
      await refreshAutoMixes(true);
      notify("Tus mezclas y descubrimientos están al día.", "success");
    } catch {
      notify("No se pudieron renovar ahora. Reintenta en un momento.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;
  const ordered = [...playlists].sort((a, b) => rank(a) - rank(b));
  return (
    <section className="blend-mixes made-for-you" aria-labelledby="made-heading" aria-busy={busy}>
      <div className="feed-heading">
        <h2 id="made-heading"><Sparkles size={19} aria-hidden="true" /> Hecho para ti</h2>
        <button className="icon-button" aria-label="Renovar mezclas y descubrimientos" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={18} className={busy ? "spin" : undefined} />
        </button>
      </div>
      <p className="feed-note">Aprende de lo que escuchas, guardas y saltas. Se renueva solo.</p>
      <div className="blend-row">
        {!ordered.length
          ? [0, 1, 2].map((i) => <div className="blend-card is-skeleton" key={i}><span className="blend-art skeleton" /><span className="skeleton album-line" /></div>)
          : ordered.map((playlist, index) => {
              const art = covers[playlist.id] ?? [];
              const discovery = playlist.id === DAILY_ID || playlist.id === WEEKLY_ID;
              return (
                <motion.button
                  key={playlist.id}
                  className={"blend-card blend-open" + (discovery ? " is-discovery" : "")}
                  aria-label={"Abrir " + playlist.title}
                  initial={reduced ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.34, ease: settle, delay: reduced ? 0 : Math.min(index, 6) * 0.05 }}
                  onClick={() => { haptic(); onOpen(playlist.id); }}
                >
                  <span className={"blend-art covers-" + Math.max(1, Math.min(art.length, 4))}>
                    {art.length ? art.map((url) => <Cover key={url} track={{ artworkUrl: url }} />) : <Cover track={{}} />}
                    {discovery && <span className="blend-badge">{playlist.id === DAILY_ID ? "HOY" : "SEMANA"}</span>}
                    <span className="blend-play" aria-hidden="true"><ChevronRight size={20} /></span>
                  </span>
                  <strong>{playlist.title}</strong>
                  <small>{playlist.trackIds.length} canciones · {playlist.subtitle?.split("·").pop()?.trim() ?? "Spotify + YouTube"}</small>
                </motion.button>
              );
            })}
      </div>
    </section>
  );
}
