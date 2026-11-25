import { useEffect, useState } from "react";
import { AudioLines } from "lucide-react";
import { Audio, Voice, isNative } from "../native";
import { VoiceMatchSetting } from "./VoiceEnrollment";

/** Switch for the "Ok MURMUR" wake phrase; the first activation downloads the ~39 MB voice model. */
export function WakeWordSetting({ notify }: { notify: (message: string, kind?: "info" | "success" | "error") => void }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"music" | "screen">("music");
  const changeMode = async (value: "music" | "screen") => {
    setMode(value);
    try {
      setMode((await Voice.setWakeMode({ mode: value })).mode);
      notify(value === "screen"
        ? "Listo: el micrófono solo se usa con MURMUR en pantalla."
        : "Listo: también escucha mientras suena música.", "success");
    } catch { /* The choice stays on screen; the service reads it on its next check. */ }
  };
  useEffect(() => {
    if (!isNative) return;
    let live = true;
    void Voice.wakeWordStatus().then((s) => { if (!live) return; setEnabled(s.enabled); if (s.mode) setMode(s.mode); }).catch(() => {});
    const handle = Audio.addListener("onWakeWordChanged" as never, ((e: { enabled: boolean; ready?: boolean }) => {
      setEnabled(e.enabled);
      setBusy(false);
      if (e.ready) notify("Listo: di «Ok MURMUR» y luego tu petición.", "success");
    }) as never);
    return () => {
      live = false;
      void Promise.resolve(handle).then((h) => (h as { remove?: () => void })?.remove?.());
    };
  }, []);
  const change = async (value: boolean) => {
    if (!isNative) return notify("La escucha de «Ok MURMUR» funciona en la app Android.", "info");
    setBusy(value);
    try {
      const result = await Voice.setWakeWord({ enabled: value });
      setEnabled(result.enabled);
      if (value && result.model === false) notify("Descargando el modelo de voz (39 MB, una sola vez)…", "info");
      if (!value) { setBusy(false); notify("Escucha de «Ok MURMUR» desactivada."); }
    } catch (e) {
      setBusy(false);
      setEnabled(false);
      notify((e as Error).message || "No se pudo activar la escucha.", "error");
    }
  };
  return (
    <>
      <label className="glow-option wake-option">
        <AudioLines size={20} />
        <span>
          {busy ? "Preparando «Ok MURMUR»…" : "Decir «Ok MURMUR»"}
          <small>
            Escucha en el teléfono sin enviar audio y comprueba dos veces la frase. Android muestra el
            indicador del micrófono mientras escucha: solo el asistente del sistema puede esperar su
            palabra sin él. Para pedir música di «pon…».
          </small>
        </span>
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => void change(e.target.checked)} />
      </label>
      {isNative && enabled && (
        <div className="wake-mode" role="radiogroup" aria-label="Cuándo escucha «Ok MURMUR»">
          <span className="wake-mode-title">¿Cuándo escucha?</span>
          <div className="wake-mode-options">
            <button role="radio" aria-checked={mode === "music"} className={mode === "music" ? "on" : ""}
              onClick={() => void changeMode("music")}>
              <strong>Con música</strong>
              <small>En pantalla, mientras suena música y 3 min después</small>
            </button>
            <button role="radio" aria-checked={mode === "screen"} className={mode === "screen" ? "on" : ""}
              onClick={() => void changeMode("screen")}>
              <strong>Solo en pantalla</strong>
              <small>Con MURMUR abierto; fuera de ahí, el micrófono se apaga</small>
            </button>
          </div>
          <small className="wake-mode-hint">Sin dejar el micrófono encendido: usa el botón de micrófono del widget, el mosaico «Voz MURMUR» de ajustes rápidos o el botón de tus audífonos.</small>
        </div>
      )}
      {isNative && enabled && <VoiceMatchSetting notify={notify} />}
    </>
  );
}
