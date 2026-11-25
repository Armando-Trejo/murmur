import { useEffect, useState } from "react";
import { Check, MessageCircle, Radio, Volume2 } from "lucide-react";
import { Audio, isNative } from "../native";

type VoiceOption = { name: string; label: string; network: boolean; selected: boolean };

/**
 * Voice extras, stored on the phone: spoken answers after «Ok MURMUR» (on by default), the presenter
 * who names each new song like a radio host (off by default) and which voice MURMUR speaks with.
 */
export function VoiceExtrasSetting({ notify }: { notify: (message: string, kind?: "info" | "success" | "error") => void }) {
  const [prefs, setPrefs] = useState({ replies: true, presenter: false });
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!isNative) return;
    let live = true;
    void Audio.voicePrefs({}).then((p) => live && setPrefs(p)).catch(() => {});
    void Audio.ttsVoices().then((v) => live && setVoices(v.voices)).catch(() => {});
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
  const choose = async (name: string) => {
    setVoices((list) => list.map((v) => ({ ...v, selected: v.name === name })));
    try {
      await Audio.setTtsVoice({ name, preview: true });
    } catch (e) {
      notify((e as Error).message || "No se pudo usar esa voz.", "error");
    }
  };
  const shown = showAll ? voices : voices.slice(0, 4);
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
      {isNative && voices.length > 0 && (prefs.replies || prefs.presenter) && (
        <div className="voice-picker" role="radiogroup" aria-label="Voz de MURMUR">
          <span className="voice-picker-title">Voz de MURMUR</span>
          <small className="voice-picker-hint">Toca una voz para escucharla y usarla. Las voces «en línea» suenan más naturales y necesitan internet.</small>
          {shown.map((voice) => (
            <button key={voice.name} role="radio" aria-checked={voice.selected}
              className={"voice-picker-option" + (voice.selected ? " on" : "")} onClick={() => void choose(voice.name)}>
              <Volume2 size={18} aria-hidden="true" />
              <span>{voice.label}</span>
              {voice.selected && <Check size={18} aria-hidden="true" />}
            </button>
          ))}
          {voices.length > 4 && (
            <button className="text-button voice-picker-more" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Ver menos" : `Ver las ${voices.length} voces`}
            </button>
          )}
        </div>
      )}
    </>
  );
}
