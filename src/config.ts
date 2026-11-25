import pkg from "../package.json";

/**
 * The Spotify app MURMUR signs in with. It comes from `.env.local` (VITE_SPOTIFY_CLIENT_ID, not in
 * the repository) at build time; anyone can still use their own in Conexiones › Opciones avanzadas.
 * A Client ID is a public identifier (PKCE, no secret), but it is kept out of the repository.
 */
export const SPOTIFY_CLIENT_ID: string = (import.meta.env?.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim() ?? "";
export const SPOTIFY_REDIRECT_URI = "http://127.0.0.1:43821/callback";
export const APP_VERSION: string = pkg.version;

/** The Client ID in use: the one typed in Opciones avanzadas, else the built-in one. */
export const spotifyClientId = () =>
  (typeof localStorage !== "undefined" && localStorage.getItem("murmur.spotify.clientId")) || SPOTIFY_CLIENT_ID;
export const spotifyAvailable = () => /^[a-f0-9]{32}$/i.test(spotifyClientId());
