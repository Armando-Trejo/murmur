import { useEffect, useState } from "react";
import {
  AudioLines,
  Play,
  ArrowUpRight,
  RefreshCw,
  LogOut,
  Copy,
  Headphones,
} from "lucide-react";
import { Auth, isNative, type ConnectionStatus } from "../native";
import { syncSpotifyLibrary } from "../core/SpotifyLibrary";
import { importYouTubeLibrary } from "../core/YouTubeLibrary";
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from "../config";
import { setSpotifyViaYouTube, spotifyViaYouTube } from "../core/spotifyBridge";

export type NoticeKind = "info" | "success" | "error";
const redirect = SPOTIFY_REDIRECT_URI;
export function ConnectionsPanel({
  status,
  onStatus,
  notify,
  onSearch,
}: {
  status: ConnectionStatus;
  onStatus: (value: ConnectionStatus) => void;
  notify: (message: string, kind?: NoticeKind) => void;
  onSearch: () => void;
}) {
  const [clientId, setClientId] = useState(
    () => localStorage.getItem("murmur.spotify.clientId") || SPOTIFY_CLIENT_ID,
  );
  const [busy, setBusy] = useState("");
  const [viaMurmur, setViaMurmur] = useState(spotifyViaYouTube);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const clientReady = /^[a-f0-9]{32}$/i.test(clientId);
  const [progress, setProgress] = useState("");
  const [returnUrl, setReturnUrl] = useState("");
  useEffect(() => {
    if (status.clientId) setClientId(status.clientId);
  }, [status.clientId]);
  async function run(action: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(action);
    try {
      if (!isNative)
        throw new Error("Conecta tus cuentas desde el APK de Android.");
      await task();
    } catch (error) {
      notify(
        (error as Error).message ||
          "No se pudo completar la operación. Intenta nuevamente.",
        "error",
      );
    } finally {
      if (isNative) {
        try {
          onStatus(await Auth.status());
        } catch {
          /* Keep the last known connection state while offline. */
        }
      }
      setBusy("");
      setProgress("");
    }
  }
  async function importYoutube() {
    const result = await importYouTubeLibrary(setProgress);
    notify(
      result.imported
        ? `${result.imported} playlists y ${result.tracks} canciones de YouTube importadas.${result.unavailable.length ? ` ${result.unavailable.length} listas no permitieron acceder a sus canciones.` : ""}`
        : "Sesión comprobada. No se encontraron playlists privadas para importar.",
      result.imported ? "success" : "info",
    );
  }
  return (
    <div className="connections-cards">
      <section className="connection-card" aria-labelledby="spotify-title">
        <div className="connection-header">
          <span className="service-logo spotify">
            <AudioLines size={26} />
          </span>
          <div>
            <h2 id="spotify-title">Spotify</h2>
            <p>
              {busy === "check"
                ? "Comprobando permisos…"
                : status.spotify
                  ? "Biblioteca autorizada"
                  : status.spotifySession
                    ? "Sesión guardada · autorización pendiente"
                    : clientReady ? "Sin conectar" : "Disponible pronto"}
            </p>
          </div>
          <span
            className={"status-dot " + (status.spotify ? "connected" : "")}
            aria-label={
              status.spotify ? "Acceso verificado" : "Sin acceso verificado"
            }
          />
        </div>
        <p className="connection-copy">
          Trae tus Me gusta y tus playlists de Spotify. MURMUR las reproduce
          por su cuenta: no necesitas abrir la app de Spotify.
        </p>
        {!status.spotify && status.spotifySession && (
          <p className="connection-notice">
            {status.spotifyMessage ||
              "Guardar la sesión web no concede permisos para sincronizar tu biblioteca. Completa la autorización OAuth."}
          </p>
        )}
        {!clientReady && (
          <p className="connection-notice">
            La conexión con Spotify todavía no está habilitada en esta versión. Mientras tanto
            puedes buscar y escuchar cualquier canción, también las de Spotify.
          </p>
        )}
        <div className="oauth-form">
          <button
            className="button primary full"
            hidden={!clientReady}
            disabled={!!busy || !clientReady}
            onClick={() =>
              void run("oauth", async () => {
                await Auth.oauthLogin({ clientId });
                notify(
                  "Completa el permiso en Spotify y vuelve a MURMUR. El acceso se comprobará al terminar.",
                );
              })
            }
          >
            {busy === "oauth"
              ? "Abriendo autorización…"
              : status.spotify
                ? "Volver a conectar Spotify"
                : "Conectar Spotify"}
            <ArrowUpRight size={18} />
          </button>
        </div>
        {(status.spotifySession ||
          status.oauth ||
          status.spotify ||
          status.spotifyEngineAuthorized ||
          status.spotifyEngineAuthorizing) && (
          <div className="connection-actions">
            <button
              disabled={!!busy}
              onClick={() =>
                void run("check", async () => {
                  const value = await Auth.verifySpotify();
                  onStatus(value);
                  if (!value.spotify)
                    throw new Error(
                      value.spotifyMessage ||
                        "Spotify no confirmó permisos de biblioteca. Autoriza la cuenta de nuevo.",
                    );
                  notify(
                    "Spotify autorizado. Ya puedes sincronizar tu biblioteca.",
                    "success",
                  );
                })
              }
            >
              <RefreshCw size={17} className={busy === "check" ? "spin" : ""} />
              Comprobar acceso
            </button>
            <button
              className="icon-button"
              aria-label="Cerrar sesión Spotify"
              disabled={!!busy}
              onClick={() =>
                void run("logout", async () => {
                  await Auth.logout({ provider: "spotify" });
                  notify(
                    "Sesión de Spotify cerrada. Tu biblioteca local se conserva.",
                    "success",
                  );
                })
              }
            >
              <LogOut size={18} />
            </button>
          </div>
        )}
        <div className="sync-actions" hidden={!clientReady}>
          <button
            className="button secondary full"
            disabled={!!busy || !status.spotify}
            onClick={() =>
              void run("sync", async () => {
                const summary = await syncSpotifyLibrary(setProgress);
                notify(
                  `${summary.tracks} canciones y ${summary.playlists} playlists sincronizadas.${summary.unavailable.length ? ` ${summary.unavailable.length} listas no permitieron acceso; sus datos locales se conservan.` : ""}${summary.topUnavailable ? " Spotify no permitió consultar tus favoritos de escucha." : ""}`,
                  summary.unavailable.length ? "info" : "success",
                );
              })
            }
          >
            <RefreshCw size={18} className={busy === "sync" ? "spin" : ""} />
            {busy === "sync"
              ? "Sincronizando biblioteca…"
              : "Sincronizar biblioteca"}
          </button>
          {progress && busy === "sync" && (
            <p className="help-copy" role="status">
              {progress}
            </p>
          )}
        </div>
        <details
          className="oauth-configuration spotify-advanced"
          open={configurationOpen}
          onToggle={(e) => setConfigurationOpen(e.currentTarget.open)}
        >
          <summary>Opciones avanzadas</summary>
          <p className="help-copy">Solo si quieres usar los motores propios de Spotify o tu propia aplicación de Spotify for Developers. No hace falta para escuchar.</p>
        <div className="spotify-engine">
          <label htmlFor="spotify-playback-mode">Reproducción de Spotify</label>
          <select
            id="spotify-playback-mode"
            value={viaMurmur ? "murmur" : status.spotifyPlaybackMode || "integrated"}
            disabled={!!busy}
            onChange={(event) =>
              void run("playback-mode", async () => {
                if (!isNative)
                  throw new Error("Selecciona el motor desde el APK Android.");
                const murmur = event.target.value === "murmur";
                setSpotifyViaYouTube(murmur);
                setViaMurmur(murmur);
                if (murmur) { notify("Spotify sonará con el motor de MURMUR.", "success"); return; }
                onStatus(
                  await Auth.setSpotifyPlaybackMode({
                    mode: event.target.value as
                      "integrated" | "web" | "connect",
                  }),
                );
                notify("Modo de reproducción actualizado.", "success");
              })
            }
          >
            <option value="murmur">MURMUR (recomendado)</option>
            <option value="integrated">Integrado · Premium</option>
            <option value="web">Integrado · Web</option>
            <option value="connect">Spotify Connect</option>
          </select>
          {viaMurmur ? (
            <p className="help-copy">
              Cada canción de Spotify suena con su misma grabación desde el motor
              de MURMUR. No necesita Premium ni la app de Spotify.
            </p>
          ) : (status.spotifyPlaybackMode || "integrated") === "integrated" ? (
            <>
              <p className="help-copy">
                El motor librespot reproduce dentro de MURMUR. No requiere abrir
                la app de Spotify. Necesita Premium y una autorización
                adicional.
              </p>
              <button
                className="button primary full"
                disabled={!!busy}
                onClick={() =>
                  void run("engine-auth", async () => {
                    if (!isNative)
                      throw new Error(
                        "Activa el motor integrado desde el APK Android.",
                      );
                    await Auth.authorizeSpotifyEngine();
                    onStatus({ ...status, spotifyEngineAuthorizing: true });
                    notify(
                      "Completa en el navegador la autorización del motor librespot y vuelve a MURMUR.",
                    );
                  })
                }
              >
                {status.spotifyEngineAuthorizing
                  ? "Reiniciar autorización del motor"
                  : status.spotifyEngineAuthorized
                    ? "Renovar motor integrado"
                    : "Activar Spotify integrado"}
                <ArrowUpRight size={18} />
              </button>
              <p className="help-copy" role="status">
                {status.spotifyEngineAuthorized
                  ? "Motor autorizado. El acceso al audio se comprueba al reproducir."
                  : "Motor pendiente de autorización. Tu sesión de biblioteca se conserva."}
              </p>
              <details className="oauth-configuration">
                <summary>El navegador no regresó</summary>
                <label htmlFor="spotify-return">
                  Enlace de retorno del motor
                </label>
                <input
                  id="spotify-return"
                  type="password"
                  autoComplete="off"
                  maxLength={8192}
                  value={returnUrl}
                  onChange={(event) => setReturnUrl(event.target.value)}
                  aria-describedby="spotify-return-help"
                />
                <p id="spotify-return-help" className="help-copy">
                  Si el navegador queda cargando, copia su enlace local, vuelve
                  a MURMUR y pégalo aquí antes de diez minutos. El enlace no se
                  guarda ni se exporta.
                </p>
                <button
                  className="button secondary full"
                  disabled={!!busy || !returnUrl.trim()}
                  onClick={() =>
                    void run("engine-return", async () => {
                      onStatus(
                        await Auth.completeSpotifyEngineAuthorization({
                          url: returnUrl.trim(),
                        }),
                      );
                      setReturnUrl("");
                      notify(
                        "Motor autorizado. Vuelve a elegir una canción.",
                        "success",
                      );
                    })
                  }
                >
                  Completar autorización
                </button>
              </details>
            </>
          ) : status.spotifyPlaybackMode === "web" ? (
            <>
              <p className="help-copy">
                Alternativa para cuentas a las que Spotify rechaza las claves de
                librespot. Usa el Web Playback SDK dentro de MURMUR y requiere
                Premium. No abre la app oficial.
              </p>
              <p className="help-copy">
                Habilita Web Playback SDK en tu aplicación de Spotify for
                Developers y pulsa Autorizar Spotify más abajo para renovar los
                permisos. Mantén el mismo Client ID y Redirect URI de tu
                biblioteca.
              </p>
              <p className="help-copy" role="status">
                {status.spotifyWebAuthorized
                  ? "Permisos Web autorizados. El audio protegido se comprueba al reproducir."
                  : "Pendiente de renovar Autorizar Spotify con permisos de reproducción Web."}
              </p>
            </>
          ) : (
            <p className="help-copy">
              Connect controla la app oficial o un dispositivo Spotify. Este
              modo sí utiliza un reproductor externo.
            </p>
          )}
        </div>
          <h3 className="advanced-title">Aplicación de Spotify</h3>

            <label htmlFor="spotify-client">Client ID de Spotify</label>
            <input
              id="spotify-client"
              aria-describedby="spotify-client-help"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              value={clientId}
              onChange={(e) => {
                const value = e.target.value.trim();
                setClientId(value);
                localStorage.setItem("murmur.spotify.clientId", value);
              }}
            />
            <p id="spotify-client-help" className="help-copy">
              Lo encontrarás en Settings de tu aplicación de Spotify for
              Developers. MURMUR usa PKCE y no necesita Client Secret.
            </p>
            <div className="redirect-row">
              <code>{redirect}</code>
              <button
                className="icon-button"
                aria-label="Copiar Redirect URI"
                onClick={() => {
                  if (!navigator.clipboard) {
                    notify(
                      "Selecciona y copia la URL de retorno que aparece en pantalla.",
                    );
                    return;
                  }
                  void navigator.clipboard
                    .writeText(redirect)
                    .then(() => notify("Redirect URI copiada.", "success"))
                    .catch(() =>
                      notify(
                        "No se pudo copiar. Selecciona la URL manualmente.",
                        "error",
                      ),
                    );
                }}
              >
                <Copy size={18} />
              </button>
            </div>
            <p className="help-copy">
              Añade exactamente esta Redirect URI a la configuración de Spotify
              antes de autorizar.
            </p>
            <button
              className="button secondary full"
              onClick={() =>
                void run("android-setup", async () => {
                  if (!isNative)
                    throw new Error(
                      "Consulta los datos de Android desde el APK instalado.",
                    );
                  const setup = await Auth.spotifyAndroidSetup();
                  await navigator.clipboard.writeText(
                    `Android package: ${setup.packageName}\nSHA-1: ${setup.sha1}\nRedirect URI: ${setup.redirectUri}`,
                  );
                  notify(
                    "Paquete y huella copiados. Regístralos en Spotify for Developers → Settings → Android.",
                    "success",
                  );
                })
              }
              disabled={!!busy}
            >
              <Copy size={18} />
              Copiar configuración Android
            </button>
            <p className="help-copy">
              Estos datos solo se utilizan para Connect/App Remote. El motor
              integrado no necesita registrar el paquete ni la huella Android.
            </p>
                  <button
          className="text-button"
          onClick={() =>
            void run("open", async () => {
              await Auth.openSpotify();
            })
          }
        >
          Abrir app de Spotify
          <ArrowUpRight size={16} />
        </button>
        </details>
      </section>
      <section className="connection-card" aria-labelledby="youtube-title">
        <div className="connection-header">
          <span className="service-logo youtube">
            <Play size={25} fill="currentColor" />
          </span>
          <div>
            <h2 id="youtube-title">YouTube Music</h2>
            <p>{status.youtubeSession ? "Cuenta conectada" : "Funciona sin cuenta"}</p>
          </div>
          <Headphones size={22} />
        </div>
        <p className="connection-copy">
          Busca y escucha cualquier canción sin iniciar sesión. Si entras con tu
          cuenta, MURMUR trae tu Inicio, tus Me gusta y tus playlists.
        </p>
        <button className="button secondary full" onClick={onSearch}>
          Buscar música
          <ArrowUpRight size={18} />
        </button>
        <button
          className={"button full private-login " + (status.youtubeSession ? "secondary" : "primary")}
          disabled={!!busy}
          onClick={() =>
            void run("youtube-login", async () => {
              await Auth.login({ provider: "youtube" });
              notify(
                "Sesión guardada. Comprobando acceso a playlists privadas…",
              );
              await importYoutube();
            })
          }
        >
          {status.youtubeSession
            ? "Volver a entrar a YouTube Music"
            : "Entrar con mi cuenta de YouTube Music"}
        </button>
        {status.youtubeSession && (
          <div className="connection-actions">
            <button
              disabled={!!busy}
              onClick={() => void run("youtube-sync", importYoutube)}
            >
              <RefreshCw
                size={17}
                className={busy === "youtube-sync" ? "spin" : ""}
              />
              Importar playlists
            </button>
            <button
              className="icon-button"
              aria-label="Cerrar sesión YouTube"
              disabled={!!busy}
              onClick={() =>
                void run("youtube-logout", async () => {
                  await Auth.logout({ provider: "youtube" });
                  notify(
                    "Sesión privada de YouTube cerrada. El audio público sigue disponible.",
                    "success",
                  );
                })
              }
            >
              <LogOut size={18} />
            </button>
          </div>
        )}
        {progress && busy.startsWith("youtube") && (
          <p className="help-copy" role="status">
            {progress}
          </p>
        )}
      </section>
    </div>
  );
}
