import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Copy, Link2, Radio, RefreshCw, Share2, Users, Wifi, X } from "lucide-react";
import qrcode from "qrcode-generator";
import mark from "../assets/murmur-mark.png";
import { Voice, isNative } from "../native";
import { shareLinks, shareTrack, type ShareLink } from "../core/share";
import { jamSession, onJamChange, refreshJamAddress, startJam, stopJam } from "../core/jam";
import { haptic } from "../core/haptics";
import { settle } from "../core/motion";
import type { QueueItem } from "../core/types";

type Notify = (message: string, tone?: "info" | "error") => void;

/* ---------------------------------- Compartir ---------------------------------- */

function PlatformGlyph({ platform }: { platform: ShareLink["platform"] }) {
  return platform === "youtube" ? (
    <span className="share-glyph yt" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="10" fill="#ff0033" /><path d="M10 8.5v7l6-3.5z" fill="#fff" /></svg>
    </span>
  ) : (
    <span className="share-glyph sp" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="10" fill="#1ed760" /><path d="M7 9.2c3.4-1 7.2-.7 10 1M7.6 12.3c2.8-.8 5.8-.5 8.2.9M8.2 15.2c2.2-.6 4.4-.4 6.3.7" stroke="#000" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>
    </span>
  );
}

/** "Compartir": the song's link on YouTube Music and on Spotify, only where the song really is. */
export function ShareOptions({ track, onDone, notify }: { track: QueueItem; onDone: () => void; notify: Notify }) {
  const [links, setLinks] = useState<ShareLink[] | undefined>();
  useEffect(() => {
    let live = true;
    setLinks(undefined);
    void shareLinks(track).then((found) => live && setLinks(found)).catch(() => live && setLinks([]));
    return () => { live = false; };
  }, [track.id]);
  const copy = async (link: ShareLink) => {
    try {
      await navigator.clipboard.writeText(link.url);
      haptic("confirm");
      notify("Enlace copiado");
      onDone();
    } catch { notify("No se pudo copiar el enlace", "error"); }
  };
  return (
    <div className="share-options">
      <h2>Compartir canción</h2>
      {!links ? (
        <div className="share-loading" role="status"><RefreshCw className="spin" size={18} /> Buscando la canción en YouTube Music y Spotify…</div>
      ) : !links.length ? (
        <p className="share-empty">No encontré un enlace público de esta canción.</p>
      ) : (
        links.map((link) => (
          <div className="share-row" key={link.platform}>
            <button
              className="share-main"
              onClick={() => {
                haptic();
                void shareTrack(track, link).then(onDone).catch(() => notify("No se pudo abrir Compartir", "error"));
              }}
            >
              <PlatformGlyph platform={link.platform} />
              <span>
                <strong>Enlace de {link.label}</strong>
                <small>{link.url.replace(/^https:\/\//, "")}</small>
              </span>
              <Share2 size={19} aria-hidden="true" />
            </button>
            <button className="icon-button share-copy" aria-label={"Copiar enlace de " + link.label} onClick={() => void copy(link)}>
              <Copy size={18} />
            </button>
          </div>
        ))
      )}
      {links && links.length === 1 && (
        <p className="share-note">
          {links[0].platform === "youtube" ? "No encontré esta misma canción en Spotify." : "No encontré esta misma canción en YouTube Music."}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------- JAM -------------------------------------- */

/** The JAM's QR in MURMUR's colors: dark rounded modules on a light card, the mark in the middle. */
export function BrandedQr({ url, size = 236 }: { url: string; size?: number }) {
  const { cells, n } = useMemo(() => {
    const qr = qrcode(0, "H");
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const cells: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      cells.push([]);
      for (let c = 0; c < n; c++) cells[r].push(qr.isDark(r, c));
    }
    return { cells, n };
  }, [url]);
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  // Room for the mark: about a fifth of the code, error correction H keeps it readable.
  const hole = Math.ceil(n * 0.22) | 1;
  const from = (n - hole) / 2;
  const inHole = (r: number, c: number) => r >= from - 0.5 && r < from + hole - 0.5 && c >= from - 0.5 && c < from + hole - 0.5;
  const dots: JSX.Element[] = [];
  cells.forEach((row, r) => row.forEach((dark, c) => {
    if (dark && !finder(r, c) && !inHole(r, c)) dots.push(<rect key={r * n + c} x={c + 0.04} y={r + 0.04} width={0.92} height={0.92} rx={0.32} />);
  }));
  const eye = (x: number, y: number) => (
    <g key={x + "-" + y}>
      <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={2} fill="none" stroke="url(#jam-eye)" strokeWidth={1} />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={1} fill="url(#jam-eye)" />
    </g>
  );
  const pad = 2;
  return (
    <svg className="jam-qr" viewBox={`${-pad} ${-pad} ${n + pad * 2} ${n + pad * 2}`} width={size} height={size} role="img" aria-label="Código QR para entrar a la JAM">
      <defs>
        <linearGradient id="jam-eye" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a1a63" />
          <stop offset="1" stopColor="#3d2590" />
        </linearGradient>
      </defs>
      <rect x={-pad} y={-pad} width={n + pad * 2} height={n + pad * 2} rx={3.2} fill="#ffffff" />
      <g fill="#120b22">{dots}</g>
      {eye(0, 0)}
      {eye(n - 7, 0)}
      {eye(0, n - 7)}
      <rect x={from - 0.2} y={from - 0.2} width={hole + 0.4} height={hole + 0.4} rx={hole * 0.28} fill="#000" />
      <image href={mark} x={from + hole * 0.14} y={from + hole * 0.14} width={hole * 0.72} height={hole * 0.72} />
    </svg>
  );
}

const useJam = () => useSyncExternalStore(onJamChange, jamSession);

/** Starts the JAM and shows its QR, who joined and how to end it. */
export function JamPanel({ notify, onClose }: { notify: Notify; onClose: () => void }) {
  const session = useJam();
  const reduced = useReducedMotion();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const begin = async () => {
    setStarting(true);
    setError("");
    try {
      await startJam();
      haptic("confirm");
    } catch (e) {
      setError((e as Error).message || "No se pudo empezar la JAM.");
    } finally { setStarting(false); }
  };
  useEffect(() => {
    if (!session) { void begin(); return; }
    void refreshJamAddress();
    const timer = setInterval(() => void refreshJamAddress(), 8000);
    return () => clearInterval(timer);
  }, [!!session]);
  const guests = session?.guests ?? [];
  return (
    <div className="jam-panel">
      <div className="jam-head">
        <span className="jam-badge"><Radio size={14} /> JAM</span>
        {session && <span className="jam-live"><i /> En vivo</span>}
      </div>
      <h2>Que tus amigos pongan música</h2>
      {error ? (
        <div className="jam-error" role="alert">
          <Wifi size={20} />
          <p>{error}</p>
          <button className="button primary" onClick={() => void begin()}>Intentar de nuevo</button>
        </div>
      ) : !session ? (
        <div className="jam-qr-card loading" role="status"><RefreshCw className="spin" size={22} /> Preparando la JAM…</div>
      ) : (
        <>
          <motion.div
            className="jam-qr-card"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduced ? 0.1 : 0.4, ease: settle }}
          >
            <BrandedQr url={session.url} />
            <p className="jam-qr-caption">Escanea con la cámara</p>
          </motion.div>
          <p className="jam-help">
            Se abre en su navegador, sin instalar nada: buscan, añaden y ordenan canciones. Deben estar en tu mismo Wi-Fi o en el hotspot de este teléfono. Lo que añadan no cambia tus recomendaciones, salvo que tú le des ♥.
          </p>
          <div className="jam-actions">
            <button
              className="button secondary"
              onClick={() => void (isNative
                ? Voice.shareText({ title: "Únete a mi JAM", text: "Únete a mi JAM de MURMUR y pon canciones: " + session.url })
                : navigator.clipboard.writeText(session.url)).catch(() => {})}
            >
              <Link2 size={18} /> Enviar enlace
            </button>
            <button
              className="button danger"
              onClick={() => {
                haptic("confirm");
                void stopJam().then(() => { notify("JAM terminada"); onClose(); });
              }}
            >
              <X size={18} /> Terminar JAM
            </button>
          </div>
          <section className="jam-guests" aria-label="Personas en la JAM">
            <h3><Users size={16} /> {guests.length ? guests.length === 1 ? "1 persona" : guests.length + " personas" : "Esperando a tus invitados"}</h3>
            {guests.map((g) => (
              <span className="jam-guest" key={g.id}>
                <b>{g.name.slice(0, 1).toUpperCase()}</b>
                {g.name}
                {g.added > 0 && <small>{g.added} {g.added === 1 ? "canción" : "canciones"}</small>}
              </span>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

/** The player's JAM button: shows that a JAM is live and how many joined. */
export function JamButton({ onOpen }: { onOpen: () => void }) {
  const session = useJam();
  return (
    <button className={"mix-now jam-button" + (session ? " live" : "")} onClick={() => { haptic(); onOpen(); }}>
      <Radio size={18} />
      {session ? <>JAM en vivo{session.guests.length ? " · " + session.guests.length : ""}</> : "JAM"}
    </button>
  );
}
