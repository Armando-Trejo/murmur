import { useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, Clock3, Flame, Headphones, Play, SkipForward } from "lucide-react";
import { db } from "../core/db";
import { computeInsights, formatListening, hourRange } from "../core/insights";
import { settle } from "../core/motion";
import type { QueueItem } from "../core/types";

const ranges = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: null, label: "Todo" },
] as const;
const dayNames: Record<string, string> = { D: "domingo", L: "lunes", M: "martes", X: "miércoles", J: "jueves", V: "viernes", S: "sábado" };

export function ListeningInsights({ tracks, onBack, onPlay, onArtist, renderCover }: {
  tracks: QueueItem[];
  onBack: () => void;
  onPlay: (items: QueueItem[], index: number) => void;
  onArtist: (name: string) => void;
  renderCover: (track?: QueueItem) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const [range, setRange] = useState<number | null>(7);
  const history = useLiveQuery(() => db.history.toArray(), [], undefined);
  const lookup = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  const insights = useMemo(
    () => computeInsights(history ?? [], lookup, Date.now(), range),
    [history, lookup, range],
  );
  const topSongs = insights.topTracks.flatMap(entry => {
    const track = lookup.get(entry.trackId);
    return track ? [{ track, entry }] : [];
  });
  const peak = Math.max(...insights.daily.map(day => day.seconds), 1);
  const peakIndex = insights.daily.findIndex(day => day.seconds === peak);
  const sourceTotal = insights.sources.spotify + insights.sources.youtube;
  const reveal = (index: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduced ? 0.1 : 0.26, delay: reduced ? 0 : index * 0.04, ease: settle },
  });
  return (
    <section className="insights" aria-labelledby="insights-title">
      <button className="text-button" onClick={onBack}>
        <ChevronLeft size={20} /> Tu Biblioteca
      </button>
      <div className="page-title">
        <h1 id="insights-title">Tu resumen</h1>
        <p>Calculado en este teléfono con tu historial de MURMUR.</p>
      </div>
      <div className="segmented insights-range" role="group" aria-label="Periodo">
        {ranges.map(option => (
          <button key={option.label} className={range === option.days ? "active" : ""}
            aria-pressed={range === option.days} onClick={() => setRange(option.days)}>
            {option.label}
          </button>
        ))}
      </div>
      {history === undefined ? (
        <div className="insights-loading skeleton" role="status" aria-label="Calculando tu resumen" />
      ) : !insights.totalSeconds ? (
        <div className="empty-state">
          <Headphones size={42} />
          <h2>{history.length ? "Sin escuchas en este periodo" : "Tu resumen empieza con la primera canción"}</h2>
          <p>Cada canción cuenta a partir de los 30 segundos. Tus datos no salen del teléfono.</p>
        </div>
      ) : (
        <>
          <motion.div className="insights-hero" {...reveal(0)}>
            <small>Tiempo escuchado</small>
            <strong>{formatListening(insights.totalSeconds)}</strong>
            <span>
              {insights.plays} reproducciones · {insights.distinctTracks} canciones · {insights.distinctArtists} artistas
            </span>
          </motion.div>
          <motion.div className="insights-tiles" {...reveal(1)}>
            <div className="insight-tile">
              <Flame size={19} aria-hidden="true" />
              <small>Racha</small>
              <strong>{insights.streak} {insights.streak === 1 ? "día" : "días"}</strong>
            </div>
            <div className="insight-tile">
              <Clock3 size={19} aria-hidden="true" />
              <small>Tu hora</small>
              <strong>{insights.favoriteHour === undefined ? "—" : hourRange(insights.favoriteHour)}</strong>
            </div>
            <div className="insight-tile">
              <SkipForward size={19} aria-hidden="true" />
              <small>Saltadas</small>
              <strong>{Math.round(insights.skipRate * 100)} %</strong>
            </div>
          </motion.div>
          <motion.figure className="insights-week" {...reveal(2)}>
            <figcaption>
              <h2>Últimos 7 días</h2>
              <span className="muted">Minutos por día</span>
            </figcaption>
            <div className="week-bars" role="list">
              {insights.daily.map((day, index) => {
                const label = `${day.today ? "Hoy" : dayNames[day.label]}: ${formatListening(day.seconds)}`;
                const labelled = day.today || (index === peakIndex && day.seconds > 0);
                return (
                  <div className={"week-day" + (day.today ? " today" : "")} role="listitem" key={day.key}
                    tabIndex={0} aria-label={label} data-tip={label}>
                    <span className="week-value" aria-hidden="true">{labelled ? Math.round(day.seconds / 60) : ""}</span>
                    <span className="week-track" aria-hidden="true">
                      <motion.i
                        initial={{ scaleY: reduced ? 1 : 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ duration: reduced ? 0 : 0.42, delay: reduced ? 0 : 0.08 + index * 0.03, ease: settle }}
                        style={{ height: `${Math.max(day.seconds ? 4 : 0, (day.seconds / peak) * 100)}%` }}
                      />
                    </span>
                    <span className="week-label" aria-hidden="true">{day.label}</span>
                  </div>
                );
              })}
            </div>
          </motion.figure>
          {sourceTotal > 0 && (
            <motion.div className="insights-sources" {...reveal(3)}>
              <h2>De dónde viene tu música</h2>
              {(["spotify", "youtube"] as const).map(source => {
                const share = insights.sources[source] / sourceTotal;
                return (
                  <div className="source-meter" key={source}>
                    <span>
                      <strong>{source === "spotify" ? "Spotify" : "YouTube"}</strong>
                      <small>{Math.round(share * 100)} % · {formatListening(insights.sources[source])}</small>
                    </span>
                    <span className="meter-track" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></span>
                  </div>
                );
              })}
            </motion.div>
          )}
          {insights.topArtists.length > 0 && (
            <motion.div {...reveal(4)}>
              <div className="section-heading"><h2>Tus artistas</h2></div>
              <ol className="insight-rank">
                {insights.topArtists.map((artist, index) => (
                  <li key={artist.name}>
                    <button onClick={() => onArtist(artist.name)} aria-label={`Ver ${artist.name}`}>
                      <span className="rank-number">{index + 1}</span>
                      {renderCover(lookup.get(artist.trackId))}
                      <span className="rank-copy">
                        <strong>{artist.name}</strong>
                        <small>{artist.plays} {artist.plays === 1 ? "reproducción" : "reproducciones"} · {formatListening(artist.seconds)}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </motion.div>
          )}
          {topSongs.length > 0 && (
            <motion.div {...reveal(5)}>
              <div className="section-heading">
                <h2>Tus canciones</h2>
                <button className="text-button" onClick={() => onPlay(topSongs.map(song => song.track), 0)}>
                  <Play size={16} fill="currentColor" /> Reproducir
                </button>
              </div>
              <ol className="insight-rank">
                {topSongs.map(({ track, entry }, index) => (
                  <li key={track.id}>
                    <button onClick={() => onPlay(topSongs.map(song => song.track), index)} aria-label={`Reproducir ${track.title}`}>
                      <span className="rank-number">{index + 1}</span>
                      {renderCover(track)}
                      <span className="rank-copy">
                        <strong>{track.title}</strong>
                        <small>{track.artist} · {entry.plays} {entry.plays === 1 ? "vez" : "veces"}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </motion.div>
          )}
          <p className="privacy-note">Los datos de este resumen se guardan sólo en tu teléfono y viajan en tus respaldos.</p>
        </>
      )}
    </section>
  );
}
