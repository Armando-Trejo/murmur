import { Coffee, Moon, Play, Sparkles, Sun } from "lucide-react";

export interface Moment { key: string; title: string; subtitle: string; request: string }

/**
 * The music for this moment of the day, mixed from YouTube Music playlists for the mood and ordered
 * by the artists you already listen to (the same engine as «pon algo tranquilo para trabajar»).
 */
export function momentFor(hour: number, weekday: number): Moment {
  const weekend = weekday === 0 || weekday === 6;
  if (hour >= 5 && hour < 11)
    return { key: "morning", title: "Para empezar el día", subtitle: "Energía para arrancar", request: "pon algo animado para empezar el dia" };
  if (hour >= 11 && hour < 18)
    return weekend
      ? { key: "weekend", title: "Para el fin de semana", subtitle: "Buena vibra", request: "pon algo alegre para el fin de semana" }
      : { key: "focus", title: "Para concentrarte", subtitle: "Sin distracciones", request: "pon algo para concentrarme" };
  if (hour >= 18 && hour < 23)
    return { key: "evening", title: "Para la noche", subtitle: "Para bajar el ritmo", request: "pon algo tranquilo para la noche" };
  return { key: "late", title: "Para desvelarte", subtitle: "Suave, de madrugada", request: "pon algo relajado para dormir" };
}

const icons = { morning: Sun, focus: Coffee, weekend: Sparkles, evening: Moon, late: Moon } as const;

export function MomentMix({ onPlay, busy, now = new Date() }: { onPlay: (request: string) => void; busy?: boolean; now?: Date }) {
  const moment = momentFor(now.getHours(), now.getDay());
  const Icon = icons[moment.key as keyof typeof icons] ?? Sparkles;
  return (
    <button className={"moment-mix moment-" + moment.key} disabled={busy} onClick={() => onPlay(moment.request)}
      aria-label={`${moment.title}: reproducir`}>
      <span className="moment-icon" aria-hidden="true"><Icon size={22} /></span>
      <span className="moment-text">
        <small>Mix del momento</small>
        <strong>{moment.title}</strong>
        <span>{busy ? "Preparando…" : moment.subtitle}</span>
      </span>
      <span className="moment-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
    </button>
  );
}
