import { useEffect, useState } from "react";
import { ArrowUpRight, DownloadCloud, RefreshCw } from "lucide-react";
import { Audio, isNative } from "../native";
import { APP_VERSION } from "../config";
import { RELEASES_PAGE, checkForUpdate, type Release } from "../core/updates";

type Notify = (message: string, kind?: "info" | "success" | "error") => void;

/**
 * Downloads the release APK from GitHub and opens Android's installer. Shared by the update card in
 * Opciones and the "Hay una versión nueva" notice.
 */
export async function installRelease(release: Release, onProgress?: (percent: number) => void) {
  const handle = await Audio.addListener("onUpdateProgress", (e) => onProgress?.(Number(e.percent) || 0));
  try {
    await Audio.installUpdate({ url: release.url });
  } catch (error) {
    const code = (error as { code?: string }).code;
    // Signed with another key, or a download Android refused: the release page still works.
    if (code === "UPDATE_SIGNATURE" || !/\.apk$/i.test(release.url)) {
      await Audio.openUpdate({ url: release.page }).catch(() => {});
    }
    throw error;
  } finally {
    void handle.remove();
  }
}

/** "MURMUR al día": current version, check now, download and install from GitHub, see what's new. */
export function UpdateCard({ notify }: { notify: Notify }) {
  const [release, setRelease] = useState<Release>();
  const [state, setState] = useState<"idle" | "checking" | "latest" | "downloading">("idle");
  const [percent, setPercent] = useState(0);
  const check = async (quiet = false) => {
    setState("checking");
    const found = await checkForUpdate(Date.now(), true);
    setRelease(found);
    setState(found ? "idle" : "latest");
    if (!quiet && !found) notify(`Tienes la versión más reciente (${APP_VERSION}).`, "success");
  };
  useEffect(() => { if (isNative) void check(true); }, []);
  const install = async () => {
    if (!release) return;
    if (!isNative) { notify("Instala actualizaciones desde la app Android."); return; }
    setState("downloading");
    setPercent(0);
    try {
      await installRelease(release, setPercent);
      notify("Toca Instalar en la ventana de Android. Tu biblioteca y tus cuentas se conservan.", "success");
    } catch (error) {
      notify((error as Error).message || "No se pudo descargar la actualización.", "error");
    } finally {
      setState("idle");
    }
  };
  return (
    <section className="update-card" aria-labelledby="update-title">
      <div className="update-head">
        <span className="update-icon"><DownloadCloud size={22} /></span>
        <div>
          <h3 id="update-title">{release ? `MURMUR ${release.version} disponible` : "MURMUR al día"}</h3>
          <p>
            {state === "checking"
              ? "Buscando en GitHub…"
              : release
                ? `Tienes la ${APP_VERSION}. Se descarga de GitHub y se instala encima, sin perder nada.`
                : `Versión ${APP_VERSION}${state === "latest" ? " · es la más reciente" : ""}`}
          </p>
        </div>
      </div>
      {state === "downloading" && (
        <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${Math.max(4, percent)}%` }} />
        </div>
      )}
      <div className="update-actions">
        {release ? (
          <button className="button primary" disabled={state === "downloading"} onClick={() => void install()}>
            <DownloadCloud size={18} />
            {state === "downloading" ? `Descargando ${percent} %` : "Descargar e instalar"}
          </button>
        ) : (
          <button className="button secondary" disabled={state === "checking"} onClick={() => void check()}>
            <RefreshCw size={17} className={state === "checking" ? "spin" : ""} />
            Buscar actualización
          </button>
        )}
        <button
          className="button ghost"
          onClick={() => void (isNative ? Audio.openUpdate({ url: release?.page ?? RELEASES_PAGE }) : Promise.resolve(window.open(RELEASES_PAGE, "_blank")))}
        >
          Novedades <ArrowUpRight size={16} />
        </button>
      </div>
    </section>
  );
}
