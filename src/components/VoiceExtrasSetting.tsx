import { useEffect, useState } from "react";
import { MessageCircle, Radio } from "lucide-react";
import { Audio, isNative } from "../native";

/**
 * Two voice extras, stored on the phone: spoken answers after «Ok MURMUR» (on by default) and the
 * presenter, who names each new song over the music like a radio host (off by default).
 */
export function VoiceExtrasSetting({ notify }: { notify: (message: string, kind?: "info" | "success" | "error") => void }) {
  const [prefs, setPrefs] = useState({ replies: true, presenter: false });
  useEffect(() => {
    if (!isNative) return;
    let live = true;
    void Audio.voicePrefs({}).then((p) => live && setPrefs(p)).catch(() => {});
    return () => { live = false; };
  }, []);
  const change = async (key: "replies" | "presenter", value: boolean) => {
    if (!isNative) return notify("Las respuestas habladas funcionan en la app Android.", "info");
    try {
      setPrefs(await Audio.voicePrefs({ [key]: value }));
      if (key === "presenter" && value) {
        notify("Presentador activado: te dirá qué canción empieza.", "success");
        void Audio.speak({ text: "Hola. Desde ahora te digo qué canción va sonando.", force: true }).catch(() => {});
      }
    } catch (e) {
      notify((e as Error).message || "No se pudo cambiar el ajuste.", "error");
    }
  };
  return (
    <>
      <label className="glow-option">
        <MessageCircle size={20} />
        <span>
          Respuestas habladas
          <small>Después de «Ok MURMUR», te contesta en voz alta (por ejemplo «En pausa» o qué canción suena).</small>
        </span>
        <input type="checkbox" checked={prefs.replies} onChange={(e) => void change("replies", e.target.checked)} />
      </label>
      <label className="glow-option">
        <Radio size={20} />
        <span>
          Presentador
          <small>Como en la radio: al empezar cada canción dice su nombre y artista, con la música más baja un momento.</small>
        </span>
        <input type="checkbox" checked={prefs.presenter} onChange={(e) => void change("presenter", e.target.checked)} />
      </label>
    </>
  );
}
