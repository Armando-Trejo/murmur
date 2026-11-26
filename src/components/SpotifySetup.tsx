import { useState } from "react";
import { ArrowUpRight, Check, ClipboardPaste, Copy } from "lucide-react";
import { Audio, isNative } from "../native";
import { SPOTIFY_REDIRECT_URI } from "../config";

type Notify = (message: string, kind?: "info" | "success" | "error") => void;
const DASHBOARD = "https://developer.spotify.com/dashboard/create";
export const validClientId = (value: string) => /^[a-f0-9]{32}$/i.test(value.trim());

/**
 * Spotify only lets each person use the Web API with their own free "app" key (a Client ID), so
 * MURMUR ships without one and walks the person through creating theirs: nothing of the developer's
 * is built in. The Client ID is a public identifier (PKCE, no secret) and stays on this phone.
 */
export function SpotifySetup({
  clientId,
  onClientId,
  notify,
}: {
  clientId: string;
  onClientId: (value: string) => void;
  notify: Notify;
}) {
  const [copied, setCopied] = useState("");
  // Someone who already pasted a key only needs the last step; the guide stays one tap away.
  const [showSteps, setShowSteps] = useState(() => !validClientId(clientId));
  const copy = (label: string, text: string) => {
    if (!navigator.clipboard) { notify("Selecciona el texto y cópialo."); return; }
    void navigator.clipboard.writeText(text).then(
      () => { setCopied(label); setTimeout(() => setCopied(""), 1600); },
      () => notify("No se pudo copiar. Selecciona el texto.", "error"),
    );
  };
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const match = text.match(/[a-f0-9]{32}/i)?.[0];
      if (!match) { notify("Lo que copiaste no parece un Client ID (32 letras y números)."); return; }
      onClientId(match);
      notify("Client ID listo. Ahora toca Conectar Spotify.", "success");
    } catch {
      notify("Mantén presionado el campo y elige Pegar.");
    }
  };
  const field = (label: string, value: string) => (
    <div className="setup-field">
      <span>{label}</span>
      <code>{value}</code>
      <button className="icon-button" aria-label={`Copiar ${label}`} onClick={() => copy(label, value)}>
        {copied === label ? <Check size={17} /> : <Copy size={17} />}
      </button>
    </div>
  );
  const ready = validClientId(clientId);
  return (
    <div className="spotify-setup">
      {showSteps && <p className="setup-lead">
        Spotify pide que cada persona use su propia llave gratuita. Se crea una vez, en unos 2 minutos.
      </p>}
      {!showSteps && (
        <button className="text-button setup-again" onClick={() => setShowSteps(true)}>
          Ver cómo crear la llave
        </button>
      )}
      <ol className={"setup-steps" + (showSteps ? "" : " compact")}>
        {showSteps && <>
        <li>
          <strong>Abre Spotify for Developers</strong>
          <p>Entra con tu cuenta de Spotify y acepta sus términos si te los pide.</p>
          <button
            className="button secondary"
            onClick={() => void (isNative ? Audio.openLink({ url: DASHBOARD }) : Promise.resolve(window.open(DASHBOARD, "_blank")))}
          >
            Abrir y crear mi llave <ArrowUpRight size={16} />
          </button>
        </li>
        <li>
          <strong>Llena el formulario así</strong>
          {field("Nombre", "MURMUR")}
          {field("Descripción", "Mi reproductor de música")}
          {field("Redirect URI", SPOTIFY_REDIRECT_URI)}
          <p>Pega la Redirect URI y toca <b>Add</b>. En las APIs marca <b>Web API</b> y <b>Web Playback SDK</b>. Acepta y guarda.</p>
        </li>
        </>}
        <li>
          <strong>{showSteps ? "Copia tu Client ID y pégalo aquí" : "Tu llave de Spotify (Client ID)"}</strong>
          {showSteps && <p>Aparece arriba en la página de tu app, en <b>Basic Information</b>.</p>}
          <div className={"setup-paste" + (ready ? " ready" : "")}>
            <input
              aria-label="Client ID de Spotify"
              placeholder="Client ID (32 caracteres)"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={64}
              value={clientId}
              onChange={(e) => onClientId(e.target.value.trim().slice(0, 32))}
            />
            <button className="icon-button" aria-label="Pegar Client ID" onClick={() => void paste()}>
              {ready ? <Check size={18} /> : <ClipboardPaste size={18} />}
            </button>
          </div>
        </li>
      </ol>
      <p className="setup-foot">
        Spotify solo da llaves a cuentas Premium, y con Premium tus canciones suenan desde Spotify dentro de
        MURMUR, sin abrir su app. Sin Premium puedes buscar y escuchar cualquier canción igual.
      </p>
    </div>
  );
}
