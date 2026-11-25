import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, History, Mic, Play, Sparkles } from "lucide-react";
import { Auth, isNative } from "../native";
import { spotifyAvailable, spotifyClientId } from "../config";
import { WakeWordSetting } from "./WakeWordSetting";
import { settle } from "../core/motion";
import { importBackup } from "../core/db";

export const WELCOME_KEY = "murmur.welcomed";
export const needsWelcome = () => typeof localStorage !== "undefined" && !localStorage.getItem(WELCOME_KEY) &&
  (isNative || new URLSearchParams(location.search).has("bienvenida"));

type Notify = (message: string, kind?: "info" | "success" | "error") => void;

/**
 * First start: what MURMUR is, connecting your music (optional: without an account search and
 * playback already work) and "Ok MURMUR". Three short steps, skippable at any point.
 */
export function Welcome({ notify, youtubeConnected, spotifyConnected, onDone }: {
  notify: Notify;
  youtubeConnected: boolean;
  spotifyConnected: boolean;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState("");
  const reduced = useReducedMotion();
  const picker = useRef<HTMLInputElement>(null);
  /**
   * Coming from another install (an update signed with another key, a new phone): the automatic
   * copy in Descargas/MURMUR brings back library, playlists, history and preferences in one step.
   */
  const restore = async (file: File | undefined) => {
    if (!file) return;
    setBusy("restore");
    try {
      const result = await importBackup(await file.text());
      localStorage.setItem(WELCOME_KEY, String(Date.now()));
      notify(`Listo: recuperé ${result.tracks} canciones y ${result.playlists} playlists.`, "success");
      // Preferences (accent, Spotify mode, last session) apply on a fresh start.
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      setBusy("");
      notify((error as Error).message || "No se pudo leer ese respaldo.", "error");
    }
  };
  const finish = () => {
    localStorage.setItem(WELCOME_KEY, String(Date.now()));
    onDone();
  };
  const connect = async (provider: "youtube" | "spotify") => {
    setBusy(provider);
    try {
      if (provider === "youtube") {
        await Auth.login({ provider: "youtube" });
        notify("YouTube Music conectado. Tu Inicio aparecerá en Para ti.", "success");
      } else {
        await Auth.oauthLogin({ clientId: spotifyClientId() });
        notify("Acepta en Spotify y vuelve a MURMUR.");
      }
    } catch (error) {
      notify((error as Error).message || "No se pudo conectar. Puedes hacerlo después en Opciones (⋯).", "error");
    } finally {
      setBusy("");
    }
  };
  const steps = [
    <>
      <span className="welcome-mark" aria-hidden="true"><Sparkles size={30} /></span>
      <h1>Bienvenido a MURMUR</h1>
      <p>Tu música de YouTube Music y Spotify en un solo lugar. Pídela con tu voz y deja que nunca se detenga: cuando termina lo que elegiste, sigue con algo parecido.</p>
      <button className="button primary full" onClick={() => setStep(1)} disabled={busy === "restore"}>Empezar <ArrowRight size={18} /></button>
      <button className="button secondary full welcome-restore" disabled={busy === "restore"} onClick={() => picker.current?.click()}>
        <History size={18} /> {busy === "restore" ? "Restaurando…" : "Ya usaba MURMUR: restaurar"}
      </button>
      <small className="welcome-hint">Elige <b>murmur-respaldo.json</b> en Descargas › MURMUR. Trae tu biblioteca, playlists y ajustes.</small>
      <input ref={picker} type="file" accept="application/json,.json" hidden
        onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = ""; }} />
    </>,
    <>
      <span className="welcome-mark" aria-hidden="true"><Play size={28} fill="currentColor" /></span>
      <h1>Conecta tu música</h1>
      <p>Así MURMUR conoce tus gustos y trae tus playlists. Es opcional: sin cuenta ya puedes buscar y escuchar cualquier canción.</p>
      <button className={"button full " + (youtubeConnected ? "secondary" : "primary")} disabled={!!busy || youtubeConnected}
        onClick={() => void connect("youtube")}>
        {youtubeConnected ? <><Check size={18} /> YouTube Music conectado</> : busy === "youtube" ? "Abriendo…" : "Entrar con YouTube Music"}
      </button>
      {spotifyAvailable() && <button className="button secondary full" disabled={!!busy || spotifyConnected} onClick={() => void connect("spotify")}>
        {spotifyConnected ? <><Check size={18} /> Spotify conectado</> : busy === "spotify" ? "Abriendo…" : "Conectar Spotify"}
      </button>}
      <button className="text-button welcome-next" onClick={() => setStep(2)}>
        {youtubeConnected || spotifyConnected ? "Continuar" : "Ahora no"} <ArrowRight size={16} />
      </button>
    </>,
    <>
      <span className="welcome-mark" aria-hidden="true"><Mic size={28} /></span>
      <h1>Pídele música con tu voz</h1>
      <p>Toca el micrófono de arriba o activa «Ok MURMUR» para pedirla sin tocar el teléfono. Habla normal:</p>
      <ul className="welcome-examples">
        <li>«Ok MURMUR, ponme Bailarina de Miranda»</li>
        <li>«Ponme algo tranquilo para trabajar»</li>
        <li>«Pásale a la que sigue»</li>
      </ul>
      <WakeWordSetting notify={notify} />
      <button className="button primary full" onClick={finish}>Listo, a escuchar <ArrowRight size={18} /></button>
    </>,
  ];
  return (
    <motion.div className="welcome-sheet" role="dialog" aria-modal="true" aria-label="Bienvenida a MURMUR"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: settle }}>
      <div className="welcome-glow" aria-hidden="true" />
      <button className="text-button welcome-skip" onClick={finish}>Saltar</button>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} className="welcome-step"
          initial={{ opacity: 0, x: reduced ? 0 : 24 }} animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduced ? 0 : -16, transition: { duration: 0.14 } }}
          transition={{ duration: 0.28, ease: settle }}>
          {steps[step]}
        </motion.div>
      </AnimatePresence>
      <div className="welcome-dots" aria-hidden="true">
        {steps.map((_, i) => <span key={i} className={i === step ? "on" : ""} />)}
      </div>
    </motion.div>
  );
}
