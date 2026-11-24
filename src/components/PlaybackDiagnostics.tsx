import { useEffect, useState } from "react";
import { Activity, ClipboardCopy, Trash2, Wifi, WifiOff } from "lucide-react";
import { clearSamples, onSamples, readSamples, summarize, type SourceSummary } from "../core/PlaybackMetrics";
import type { ConnectionStatus } from "../native";

const seconds = (ms?: number) => (ms === undefined ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const modeNames = { integrated: "Integrado · Premium", web: "Integrado · Web", connect: "Spotify Connect" };

export function diagnosticReport(summary: Record<"youtube" | "spotify", SourceSummary>, status: ConnectionStatus, online: boolean, version: string) {
  const line = (name: string, s: SourceSummary) =>
    `${name}: ${s.count} selecciones, p50 ${seconds(s.p50)}, p95 ${seconds(s.p95)}, fallos ${s.failures}${s.lastCode ? ` (último ${s.lastCode})` : ""}`;
  return [
    `MURMUR ${version} · diagnóstico de reproducción`,
    `Red: ${online ? "con conexión" : "sin conexión"}`,
    `YouTube Music: ${status.youtubeSession ? "sesión guardada" : "modo público"}`,
    `Spotify: biblioteca ${status.spotify || status.oauth ? "autorizada" : "sin autorizar"}, modo ${modeNames[status.spotifyPlaybackMode ?? "integrated"]}`,
    line("YouTube", summary.youtube),
    line("Spotify", summary.spotify),
  ].join("\n");
}

/** Shows tap-to-playback timings measured on this device. Only codes and timings are kept. */
export function PlaybackDiagnostics({ status, online, version, notify }: {
  status: ConnectionStatus;
  online: boolean;
  version: string;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const [samples, setSamples] = useState(readSamples);
  useEffect(() => onSamples(() => setSamples(readSamples())), []);
  const summary = summarize(samples);
  return (
    <section className="settings-section diagnostics" aria-labelledby="diagnostics-heading">
      <div className="setting-label">
        <Activity size={21} />
        <div>
          <strong id="diagnostics-heading">Diagnóstico de reproducción</strong>
          <p>Tiempo desde que eliges una canción hasta que el motor confirma el audio. Se mide en este teléfono.</p>
        </div>
      </div>
      <div className="diagnostic-grid">
        {(["youtube", "spotify"] as const).map(source => {
          const s = summary[source];
          return (
            <div className="diagnostic-card" key={source}>
              <strong>{source === "youtube" ? "YouTube" : "Spotify"}</strong>
              <span><small>Típico</small>{seconds(s.p50)}</span>
              <span><small>Lento (p95)</small>{seconds(s.p95)}</span>
              <span><small>Selecciones</small>{s.count}{s.failures ? ` · ${s.failures} con error` : ""}</span>
              {s.lastCode && <code>{s.lastCode}</code>}
            </div>
          );
        })}
      </div>
      <p className="help-copy diagnostic-network">
        {online ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}
        {online ? "Con conexión" : "Sin conexión"} ·{" "}
        {status.spotify || status.oauth || status.spotifyEngineAuthorized
          ? `Spotify en modo ${modeNames[status.spotifyPlaybackMode ?? "integrated"]}`
          : "Spotify sin conectar"}
      </p>
      <div className="backup-buttons">
        <button className="button secondary" onClick={() => {
          const text = diagnosticReport(summary, status, online, version);
          void navigator.clipboard?.writeText(text)
            .then(() => notify("Informe copiado. No incluye cuentas, tokens ni enlaces.", "success"))
            .catch(() => notify("No se pudo copiar el informe.", "error"));
        }}>
          <ClipboardCopy size={18} /> Copiar informe
        </button>
        <button className="button secondary" disabled={!samples.length} onClick={() => {
          clearSamples();
          notify("Mediciones borradas.");
        }}>
          <Trash2 size={18} /> Borrar mediciones
        </button>
      </div>
    </section>
  );
}
