import { useEffect, useState } from "react";
import { Coffee, Moon, Play, Sparkles, Sun } from "lucide-react";
import { buildMomentMix, momentFor, momentMixPreview, peekMomentMix, type MomentMixResult } from "../core/momentMix";
import type { QueueItem } from "../core/types";

export { momentFor, type Moment } from "../core/momentMix";

export interface MomentMixProps {
  /** Bumped by «deslizar hacia abajo» on Inicio. */
  refreshSignal?: number;
  /**
   * The personal mix (preferred): the card builds it — your songs for this hour plus discoveries
   * near them, cached 30 min — and hands over the songs to play. While it returns a promise the card
   * shows «Preparando…». With it, the card's subtitle says why the mix is yours.
   */
  onPlayMix?: (tracks: QueueItem[], mix: MomentMixResult) => unknown;
  /**
   * The mood request for the voice router («pon algo tranquilo para la noche»): the whole behaviour
   * of earlier versions when `onPlayMix` is missing, and the fallback when no mix could be built.
   */
  onPlay?: (request: string) => void;
  busy?: boolean;
  /** Fixed time (tests); otherwise the card follows the clock. */
  now?: Date;
}

const icons = { morning: Sun, focus: Coffee, weekend: Sparkles, evening: Moon, late: Moon } as const;
const keyAt = (date: Date) => momentFor(date.getHours(), date.getDay()).key;

/** "Mix del momento": the music you play at this time of day, with discoveries close to it. */
export function MomentMix({ onPlayMix, onPlay, busy, now, refreshSignal = 0 }: MomentMixProps) {
  const [clock, setClock] = useState(() => new Date());
  const at = now ?? clock;
  const moment = momentFor(at.getHours(), at.getDay());
  const personal = !!onPlayMix;
  const [line, setLine] = useState<{ key: string; text: string } | undefined>(() => {
    const cached = peekMomentMix(at);
    return cached && { key: cached.momentKey, text: cached.subtitle };
  });
  const [working, setWorking] = useState(false);
  const [wake, setWake] = useState(0);
  useEffect(() => { if (refreshSignal) setWake((n) => n + 1); }, [refreshSignal]);

  // Follow the clock (a new moment brings a new mix) and refresh when the app comes back.
  useEffect(() => {
    if (now) return;
    const tick = () => setClock((previous) => {
      const next = new Date();
      return keyAt(next) !== keyAt(previous) ? next : previous;
    });
    const timer = setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      tick();
      setWake((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [now]);

  // The subtitle from the phone's history right away; the mix itself a moment later, so a tap is instant.
  useEffect(() => {
    if (!personal) return;
    let alive = true;
    const key = moment.key;
    const show = (mix: { momentKey: string; subtitle: string }) => {
      if (alive && mix.momentKey === key) setLine({ key, text: mix.subtitle });
    };
    void momentMixPreview(now ?? new Date()).then(show)
      .catch(() => alive && setLine((current) => current ?? { key, text: moment.subtitle }));
    const timer = setTimeout(() => void buildMomentMix(now ?? new Date()).then(show).catch(() => {}), 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [personal, moment.key, wake]);

  const play = async () => {
    if (working || busy) return;
    if (!onPlayMix) return onPlay?.(moment.request);
    setWorking(true);
    try {
      const mix = await buildMomentMix(now ?? new Date());
      setLine({ key: mix.momentKey, text: mix.subtitle });
      if (mix.tracks.length) await onPlayMix(mix.tracks, mix);
      else onPlay?.(moment.request);
    } catch {
      onPlay?.(moment.request);
    } finally {
      setWorking(false);
    }
  };

  const Icon = icons[moment.key as keyof typeof icons] ?? Sparkles;
  const subtitle = personal ? (line?.key === moment.key ? line.text : undefined) : moment.subtitle;
  return (
    <button className={"moment-mix moment-" + moment.key} disabled={busy || working} onClick={() => void play()}
      aria-label={`${moment.title}${subtitle ? ". " + subtitle : ""}: reproducir`} aria-busy={busy || working || !subtitle}>
      <span className="moment-icon" aria-hidden="true"><Icon size={22} /></span>
      <span className="moment-text">
        <small>Mix del momento</small>
        <strong>{moment.title}</strong>
        {busy || working ? <span>Preparando…</span>
          : subtitle ? <span>{subtitle}</span>
          : <span className="skeleton moment-skeleton" aria-hidden="true" />}
      </span>
      <span className="moment-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
    </button>
  );
}
