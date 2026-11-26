import { useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, CircleAlert, Fingerprint, LoaderCircle, Mic, RotateCcw, Trash2, X } from "lucide-react";
import { App as CapacitorApp } from "@capacitor/app";
import { Audio, Voice, isNative } from "../native";
import { settle } from "../core/motion";
import { haptic } from "../core/haptics";
import { ENROLL_TAKES, enrollPrompt, enrollReducer, initialEnroll, micLevel } from "../core/voiceEnrollment";

type Notify = (message: string, kind?: "info" | "success" | "error") => void;

/**
 * «Solo mi voz», under «Ok MURMUR» while it is on. The first activation opens «Entrena tu voz»;
 * once a voice is enrolled the switch only turns the check on or off (the voice is kept).
 */
export function VoiceMatchSetting({ notify }: { notify: Notify }) {
  const [enabled, setEnabled] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<number>();
  useEffect(() => {
    if (!isNative) return;
    let live = true;
    void Voice.voiceMatchStatus()
      .then((s) => {
        if (!live) return;
        setEnabled(s.enabled);
        setEnrolled(s.enrolled);
      })
      .catch(() => {});
    return () => {
      live = false;
      window.clearTimeout(confirmTimer.current);
    };
  }, []);
  const toggle = async (value: boolean) => {
    if (!isNative) return notify("«Solo mi voz» funciona en la app Android.", "info");
    if (value && !enrolled) {
      setSheet(true);
      return;
    }
    setBusy(true);
    try {
      const result = await Voice.setVoiceMatch({ enabled: value });
      setEnabled(result.enabled);
      notify(
        result.enabled ? "«Solo mi voz» activado: MURMUR responde solo a ti." : "«Solo mi voz» desactivado: MURMUR responderá a cualquier voz.",
        result.enabled ? "success" : "info",
      );
    } catch (e) {
      notify((e as Error).message || "No se pudo cambiar «Solo mi voz».", "error");
    } finally {
      setBusy(false);
    }
  };
  /** Two taps: the first only arms the button for a few seconds. */
  const erase = async () => {
    window.clearTimeout(confirmTimer.current);
    if (!confirming) {
      setConfirming(true);
      confirmTimer.current = window.setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setConfirming(false);
    try {
      await Voice.clearVoiceProfile();
      setEnabled(false);
      setEnrolled(false);
      haptic("confirm");
      notify("Tu voz se borró de este teléfono. «Ok MURMUR» responde a cualquier voz.", "success");
    } catch {
      notify("No se pudo borrar tu voz. Inténtalo de nuevo.", "error");
    }
  };
  return (
    <div className="voice-match">
      <label className="glow-option voice-match-option">
        <Fingerprint size={20} />
        <span>
          Solo mi voz
          <small>
            {enrolled
              ? "Apagado, cualquiera puede decir «Ok MURMUR». Enciéndelo solo si quieres que ignore a todos menos a ti."
              : "Apagado, cualquiera puede decir «Ok MURMUR». Si lo enciendes, ignorará a todos menos a ti."}{" "}
            Tu huella de voz se queda en este teléfono.
          </small>
        </span>
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
      </label>
      {enrolled && (
        <div className="voice-match-actions">
          <button className="text-button" onClick={() => setSheet(true)}>
            <RotateCcw size={16} /> Volver a entrenar
          </button>
          <button className={"text-button voice-match-erase" + (confirming ? " confirming" : "")} onClick={() => void erase()}>
            <Trash2 size={16} /> {confirming ? "Toca otra vez para borrar" : "Borrar mi voz"}
          </button>
        </div>
      )}
      {createPortal(
        <AnimatePresence>
          {sheet && (
            <VoiceEnrollmentSheet
              key="voice-enrollment"
              onClose={() => setSheet(false)}
              onEnrolled={() => {
                setEnrolled(true);
                setEnabled(true);
              }}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

/**
 * «Entrena tu voz»: three takes of «Ok MURMUR». The phone records each one (up to 4 s, stopping
 * when you finish), checks it and keeps your voice print; this sheet shows where you are.
 */
export function VoiceEnrollmentSheet({ onClose, onEnrolled }: { onClose: () => void; onEnrolled: () => void }) {
  const [state, dispatch] = useReducer(enrollReducer, initialEnroll);
  const [level, setLevel] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reduced = useReducedMotion();
  const alive = useRef(true);
  const current = useRef(state);
  current.current = state;
  const close = useRef(onClose);
  close.current = onClose;
  const enrolled = useRef(onEnrolled);
  enrolled.current = onEnrolled;
  const dialog = useRef<HTMLDivElement>(null);

  // Download (first time) and load the models; a failure offers to retry.
  useEffect(() => {
    let live = true;
    void Voice.voiceMatchStatus()
      .then((s) => live && setDownloading(!s.model))
      .catch(() => {});
    void Voice.prepareVoiceMatch()
      .then(() => live && dispatch({ type: "prepared" }))
      .catch((e) =>
        live && dispatch({
          type: "unavailable",
          message: (e as Error).message || "No se pudo preparar «Solo mi voz». Revisa tu conexión e inténtalo de nuevo.",
        }),
      );
    return () => {
      live = false;
    };
  }, [attempt]);

  // Live microphone events, Escape and Android's back gesture.
  useEffect(() => {
    alive.current = true;
    dialog.current?.focus({ preventScroll: true });
    const handle = Audio.addListener("onVoiceEnrollment" as never, ((e: { phase: string; rms?: number }) => {
      if (e.phase === "listening") dispatch({ type: "live" });
      else if (e.phase === "level") setLevel(micLevel(e.rms ?? 0));
      else if (e.phase === "checking") {
        setLevel(0);
        dispatch({ type: "checking" });
      }
    }) as never);
    const keys = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close.current();
    };
    document.addEventListener("keydown", keys, true);
    const back = isNative ? CapacitorApp.addListener("backButton", () => close.current()) : undefined;
    return () => {
      alive.current = false;
      document.removeEventListener("keydown", keys, true);
      void Promise.resolve(handle).then((h) => (h as { remove?: () => void })?.remove?.());
      void back?.then((h) => h.remove());
    };
  }, []);

  const listen = async () => {
    const now = current.current;
    if (now.phase !== "ready") return;
    haptic();
    setLevel(0);
    dispatch({ type: "listen" });
    try {
      const result = await Voice.enrollVoiceTake({ take: now.take });
      // Saved on the phone even if the sheet was closed meanwhile: the switch must show it.
      if (result.ok && result.done) enrolled.current();
      if (!alive.current) return;
      dispatch({ type: "result", ok: result.ok, done: result.done, restart: result.restart, message: result.message });
      haptic(result.ok ? "confirm" : "reject");
    } catch (e) {
      if (!alive.current) return;
      dispatch({ type: "result", ok: false, message: (e as Error).message || "No se pudo usar el micrófono." });
      haptic("reject");
    } finally {
      if (alive.current) setLevel(0);
    }
  };

  const working = state.phase === "listening" || state.phase === "checking";
  const waiting = state.phase === "preparing" || state.phase === "checking" || (state.phase === "listening" && !state.live);
  return (
    <motion.div
      className="sheet-backdrop voice-enroll-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, pointerEvents: "none", transition: { duration: 0.16 } }}
      transition={{ duration: 0.22, ease: settle }}
      onClick={() => close.current()}
    >
      <motion.div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-enroll-title"
        className="action-sheet voice-enroll"
        initial={{ y: reduced ? 0 : 40, opacity: reduced ? 1 : 0.7 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: reduced ? 0 : 28, opacity: 0, transition: { duration: 0.16 } }}
        transition={{ duration: reduced ? 0.1 : 0.3, ease: settle }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <button className="sheet-close icon-button" aria-label="Cerrar" onClick={() => close.current()}>
          <X size={20} />
        </button>
        {state.phase === "done" ? (
          <motion.div
            className="voice-enroll-done"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.32, ease: settle }}
          >
            <span className="voice-enroll-badge" aria-hidden="true">
              <Check size={40} strokeWidth={2.6} />
            </span>
            <h2 id="voice-enroll-title" role="status">Listo: MURMUR solo responderá a tu voz</h2>
            <p>Di «Ok MURMUR» como siempre. Si algún día no te reconoce, vuelve a entrenar desde aquí.</p>
            <button className="button primary full" onClick={() => close.current()}>Hecho</button>
          </motion.div>
        ) : (
          <>
            <h2 id="voice-enroll-title">Entrena tu voz</h2>
            <p className="voice-enroll-lead">
              Di «Ok MURMUR» tres veces con tu voz de siempre, sin ruido alrededor. Así MURMUR sabrá que eres tú.
            </p>
            <ol className="voice-enroll-steps" aria-label={`Toma ${state.take} de ${ENROLL_TAKES}`}>
              {Array.from({ length: ENROLL_TAKES }, (_, i) => i + 1).map((n) => (
                <li key={n} className={n <= state.accepted ? "done" : n === state.take ? "current" : ""}>
                  {n <= state.accepted ? <Check size={14} strokeWidth={3} /> : n}
                </li>
              ))}
            </ol>
            <button
              className={
                "voice-enroll-mic" +
                (state.phase === "listening" && state.live ? " live" : "") +
                (working ? " working" : "") +
                (state.phase === "preparing" || state.phase === "unavailable" ? " idle" : "")
              }
              style={{ "--level": level } as CSSProperties}
              disabled={state.phase !== "ready"}
              aria-label={state.phase === "ready" ? `Grabar «Ok MURMUR», toma ${state.take} de ${ENROLL_TAKES}` : enrollPrompt(state)}
              onClick={() => void listen()}
            >
              <span className="voice-enroll-halo" aria-hidden="true" />
              <span className="voice-enroll-halo outer" aria-hidden="true" />
              {waiting ? <LoaderCircle size={34} className="voice-enroll-spin" /> : <Mic size={38} />}
            </button>
            <p className={"voice-enroll-status" + (state.feedback ? " " + state.feedback.kind : "")} role="status" aria-live="polite">
              {state.feedback?.kind === "success" && <Check size={17} strokeWidth={2.6} />}
              {state.feedback?.kind === "error" && <CircleAlert size={17} />}
              <span>{state.feedback?.message ?? enrollPrompt(state)}</span>
            </p>
            {state.phase === "preparing" && downloading && (
              <p className="voice-enroll-note">Descargando el modelo de tu voz (13 MB, una sola vez)…</p>
            )}
            {state.phase === "unavailable" && (
              <button
                className="button secondary full"
                onClick={() => {
                  dispatch({ type: "retryPrepare" });
                  setAttempt((a) => a + 1);
                }}
              >
                Reintentar
              </button>
            )}
            <p className="voice-enroll-privacy">Tu huella de voz se guarda solo en este teléfono: no se envía ni entra en tus respaldos.</p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
