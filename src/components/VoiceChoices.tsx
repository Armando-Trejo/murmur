import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { player } from "../core/AudioOrchestrator";
import { release, settle } from "../core/motion";
import { VOICE_CHOICES_EVENT, type VoiceChoicesDetail } from "../core/voiceChoices";
import { Cover } from "./Cover";

/** How long the options stay when nobody touches them. */
export const VOICE_CHOICES_MS = 12_000;

/**
 * «¿No era esta?»: when MURMUR was not sure what a voice command named, the closest options it
 * found, one tap each. It listens for "murmur:voice-choices" and leaves on its own after 12 s.
 */
export function VoiceChoices() {
  const reduced = useReducedMotion();
  const [offer, setOffer] = useState<{ id: number; detail: VoiceChoicesDetail }>();
  const [busy, setBusy] = useState<number>();
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const close = () => { clearTimeout(timer.current); setOffer(undefined); setBusy(undefined); setError(""); };
  const restart = () => { clearTimeout(timer.current); timer.current = setTimeout(close, VOICE_CHOICES_MS); setRound((r) => r + 1); };

  useEffect(() => {
    const on = (event: Event) => {
      const detail = (event as CustomEvent<VoiceChoicesDetail>).detail;
      if (!detail?.choices?.length) return;
      setOffer({ id: Date.now(), detail });
      setBusy(undefined);
      setError("");
      restart();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener(VOICE_CHOICES_EVENT, on);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener(VOICE_CHOICES_EVENT, on);
      window.removeEventListener("keydown", key);
      clearTimeout(timer.current);
    };
  }, []);

  const choose = async (index: number) => {
    if (!offer || busy !== undefined) return;
    const { detail } = offer;
    const choice = detail.choices[index];
    setBusy(index);
    setError("");
    clearTimeout(timer.current);
    try {
      const songs = detail.expand ? await detail.expand(index) : [choice];
      const list = songs.length ? songs : detail.kinds?.[index] && detail.kinds[index] !== "Canción" ? [] : [choice];
      if (!list.length) throw new Error("No pude abrir esta opción");
      await player.playList(list);
      const failed = player.getSnapshot().error;
      if (failed) throw new Error(failed);
      close();
    } catch (e) {
      setBusy(undefined);
      setError((e as Error).message || "No se pudo reproducir");
      restart();
    }
  };

  const detail = offer?.detail;
  return (
    <AnimatePresence>
      {detail && (
        <motion.section
          key={offer.id}
          className="voice-choices"
          aria-label={detail.played ? "¿No era esta?" : "¿Era alguna de estas?"}
          onPointerDown={restart}
          onFocus={restart}
          initial={{ opacity: 0, y: reduced ? 0 : 16, scale: reduced ? 1 : 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: reduced ? 0 : 8, transition: { duration: 0.16, ease: release } }}
          transition={{ duration: 0.28, ease: settle }}
        >
          <header className="voice-choices-head">
            <div aria-live="polite">
              <strong>{detail.played ? "¿No era esta?" : "¿Era alguna de estas?"}</strong>
              <span className="voice-choices-heard">Escuché «{detail.heard}»</span>
            </div>
            <button type="button" className="voice-choices-close" aria-label="Cerrar opciones" onClick={close}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <ul className="voice-choices-list">
            {detail.choices.map((choice, index) => (
              <li key={choice.id + index}>
                <button
                  type="button"
                  className="voice-choice"
                  disabled={busy !== undefined}
                  aria-busy={busy === index}
                  onClick={() => void choose(index)}
                >
                  <Cover track={choice} size="small" className={"voice-choice-cover" + (detail.kinds?.[index] === "Artista" ? " round" : "")} />
                  <span className="voice-choice-text">
                    <span className="voice-choice-title">{choice.title}</span>
                    <span className="voice-choice-sub">
                      {(detail.kinds?.[index] ?? "Canción") === "Canción" ? "Canción · " + choice.artist : choice.artist}
                    </span>
                  </span>
                  {busy === index && <Loader2 className="voice-choice-spin" size={18} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="voice-choices-error" role="alert">{error}</p>}
          <span className="voice-choices-timer" aria-hidden="true" style={{ animationDuration: VOICE_CHOICES_MS + "ms" }} key={round} data-paused={busy !== undefined || undefined} />
        </motion.section>
      )}
    </AnimatePresence>
  );
}
