import { useEffect, useState } from "react";
import { DownloadCloud } from "lucide-react";
import { SMART_LIMIT, runSmartDownloads, setSmartDownloads, smartDownloadsEnabled } from "../core/smartDownloads";

/** Switch for "Descargas inteligentes" (Wi-Fi only, top songs kept on the phone). */
export function SmartDownloadsSetting({ notify }: { notify: (message: string, kind?: "info" | "success" | "error") => void }) {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { void smartDownloadsEnabled().then(setEnabled); }, []);
  const change = async (value: boolean) => {
    setEnabled(value);
    await setSmartDownloads(value);
    if (value) {
      notify(`Guardaré tus ${SMART_LIMIT} canciones más escuchadas cuando estés en Wi-Fi.`, "success");
      void runSmartDownloads();
    } else notify("Descargas inteligentes desactivadas; liberé su espacio.");
  };
  return (
    <label className="glow-option">
      <DownloadCloud size={20} />
      <span>
        Descargas inteligentes
        <small>Tus {SMART_LIMIT} canciones más escuchadas, guardadas solo con Wi-Fi para sonar sin conexión y sin gastar datos.</small>
      </span>
      <input type="checkbox" checked={enabled} onChange={(e) => void change(e.target.checked)} />
    </label>
  );
}
