import { useEffect, useState } from "react";
import { Check, Clock3, MessageCircle, Radio, Shuffle, Users, Volume2 } from "lucide-react";
import { Audio, isNative, type PresenterHost } from "../native";

type VoiceOption = { name: string; label: string; network: boolean; selected: boolean };

/**
 * Voice extras, stored on the phone: spoken answers after «Ok MURMUR» (on by default), the presenter
 * who names each new song like a radio host (off by default) and which voice MURMUR speaks with.
 */
export function VoiceExtrasSetting({ notify }: { notify: (message: string, kind?: "info" | "success" | "error") => void }) {
  const [prefs, setPrefs] = useState<{ replies: boolean; presenter: boolean; host?: PresenterHost; every?: number; moods?: boolean }>({ replies: true, presenter: false, host: "duo", every: 1, moods: true });
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
        void Audio.speak({ text: "¡Hola! Desde ahora te cuento qué canción va sonando.", force: true }).catch(() => {});
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
  const chooseHost = async (host: PresenterHost) => {
    setPrefs((p) => ({ ...p, host }));
    try {
      setPrefs(await Audio.voicePrefs({ host }));
      void Audio.presenterSample({ gender: host === "hombre" ? "hombre" : "mujer" }).catch(() => {});
      if (host === "duo") window.setTimeout(() => void Audio.presenterSample({ gender: "hombre" }).catch(() => {}), 4200);
    } catch (e) {
      notify((e as Error).message || "No se pudo cambiar el locutor.", "error");
    }
  };
  const chooseEvery = async (every: number) => {
    setPrefs((p) => ({ ...p, every }));
    try { setPrefs(await Audio.voicePrefs({ every })); } catch (e) { notify((e as Error).message || "No se pudo guardar.", "error"); }
  };
  const changeMoods = async (moods: boolean) => {
    setPrefs((p) => ({ ...p, moods }));
    try { setPrefs(await Audio.voicePrefs({ moods })); } catch (e) { notify((e as Error).message || "No se pudo guardar.", "error"); }
  };
  const frequencies = [
    { every: 1, label: "Siempre", hint: "Cada canción" },
    { every: 3, label: "Cada 3", hint: "A ratos" },
    { every: 5, label: "Cada 5", hint: "Por bloques" },
  ];
  const every = prefs.every ?? 1;
  const hosts: { id: PresenterHost; label: string; hint: string }[] = [
    { id: "duo", label: "Dúo", hint: "Se turnan" },
    { id: "mujer", label: "Locutora", hint: "Mujer" },
    { id: "hombre", label: "Locutor", hint: "Hombre" },
  ];
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
          <small>Como en la radio: presenta las canciones con la música un poco más baja, y la sube al terminar.</small>
        </span>
        <input type="checkbox" checked={prefs.presenter} onChange={(e) => void change("presenter", e.target.checked)} />
      </label>
      {prefs.presenter && (
        <div className="voice-picker" role="radiogroup" aria-label="Quién presenta las canciones">
          <span className="voice-picker-title"><Users size={16} aria-hidden="true" /> Quién presenta</span>
          <small className="voice-picker-hint">Toca para escucharlo. La música baja un poco mientras habla y vuelve sola.</small>
          <div className="host-options">
            {hosts.map((h) => (
              <button key={h.id} role="radio" aria-checked={(prefs.host ?? "duo") === h.id}
                className={"host-option" + ((prefs.host ?? "duo") === h.id ? " on" : "")} onClick={() => void chooseHost(h.id)}>
                <strong>{h.label}</strong>
                <small>{h.hint}</small>
              </button>
            ))}
          </div>
          <span className="voice-picker-title"><Clock3 size={16} aria-hidden="true" /> Cada cuánto habla</span>
          <div className="host-options" role="radiogroup" aria-label="Cada cuánto habla el presentador">
            {frequencies.map((f) => (
              <button key={f.every} role="radio" aria-checked={every === f.every}
                className={"host-option" + (every === f.every ? " on" : "")} onClick={() => void chooseEvery(f.every)}>
                <strong>{f.label}</strong>
                <small>{f.hint}</small>
              </button>
            ))}
          </div>
          {every > 1 && (
            <label className="glow-option">
              <Shuffle size={20} />
              <span>
                Cambiar de ambiente en cada bloque
                <small>Cuando la música sigue sola, cada bloque trae otro mood (alegre, fiesta, nostalgia, tranquilo…) y el presentador lo anuncia. Si pides uno («pon algo triste»), se queda en ese.</small>
              </span>
              <input type="checkbox" checked={prefs.moods !== false} onChange={(e) => void changeMoods(e.target.checked)} />
            </label>
          )}
        </div>
      )}
      {isNative && voices.length > 0 && prefs.replies && (
        <div className="voice-picker" role="radiogroup" aria-label="Voz de MURMUR">
          <span className="voice-picker-title">Voz de las respuestas</span>
          <small className="voice-picker-hint">La que te contesta después de «Ok MURMUR». Toca una para escucharla. Las «en línea» suenan más naturales y necesitan internet.</small>
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
