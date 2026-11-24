import { useEffect, useState } from "react";
import { AudioLines } from "lucide-react";
import { Audio, Voice, isNative } from "../native";

/** Switch for the "Ok MURMUR" wake phrase; the first activation downloads the ~39 MB voice model. */
export function WakeWordSetting({ notify }: { notify: (message: string, kind?: "info" | "success" | "error") => void }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isNative) return;
    let live = true;
    void Voice.wakeWordStatus().then((s) => live && setEnabled(s.enabled)).catch(() => {});
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
    <label className="glow-option wake-option">
      <AudioLines size={20} />
      <span>
        {busy ? "Preparando «Ok MURMUR»…" : "Decir «Ok MURMUR»"}
        <small>
          Escucha local sin enviar audio. Android muestra una notificación fija y el indicador del
          micrófono, y usa algo más de batería.
        </small>
      </span>
      <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => void change(e.target.checked)} />
    </label>
  );
}
