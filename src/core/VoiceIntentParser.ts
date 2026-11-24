import { normalize } from "./FanUploadParser";
import { similarity } from "./SourceResolver";
export type Platform = "spotify" | "youtube";
export type VoiceIntent =
  | { type: "mix" | "next" | "previous" | "save" | "pause" | "resume" }
  | { type: "playlist"; id: string }
  | { type: "youtube" | "vibe"; query: string }
  | { type: "artist"; query: string; platform?: Platform }
  | { type: "album"; query: string; title: string; artist?: string; platform?: Platform }
  | { type: "track"; query: string; title: string; artist: string; platform?: Platform }
  | { type: "unknown" };

/** "… en Spotify", "… desde YouTube Music", "… de youtube": the platform the user asked for, if any. */
export function splitPlatform(text: string): { text: string; platform?: Platform } {
  const match = text.match(/\s+(?:en|desde|de|por|con|on|from)\s+(spotify|youtube(?:\s+music)?|you\s+tube(?:\s+music)?|youtube music)$/);
  if (!match) return { text };
  return { text: text.slice(0, match.index).trim(), platform: /spotify/.test(match[1]) ? "spotify" : "youtube" };
}
export function stripInvocation(text: string) {
  return normalize(text)
    .replace(
      /^(?:(?:oye|ok|okay|hey)\s+)?(?:murmur|mur\s+mur|mormor)(?:\s+|$)/,
      "",
    )
    .trim();
}
export function parseVoiceIntent(
  text: string,
  playlists: { id: string; title: string }[] = [],
): VoiceIntent {
  const { text: n, platform } = splitPlatform(stripInvocation(text)
    .replace(/^(?:por favor|please)\s+/, "")
    .replace(/\s+(?:por favor|please)$/, ""));
  if (/^(mezcla ahora|mezclar ahora|mix now)$/.test(n)) return { type: "mix" };
  if (/^(siguiente|next|salta|skip)( cancion| track)?$/.test(n))
    return { type: "next" };
  if (/^(anterior|previous|go back|vuelve)( cancion| track)?$/.test(n))
    return { type: "previous" };
  if (/^(guarda|guardar|save)( esta| this)?( cancion| song| track)?$/.test(n))
    return { type: "save" };
  if (/^(pausa|pausar|pause|detente)$/.test(n)) return { type: "pause" };
  if (/^(continua|continuar|reanuda|reanudar|resume|play)$/.test(n))
    return { type: "resume" };
  const playlist = n.match(
    /^(?:pon|reproduce|play) (?:mi |my )?playlist (.+)$/,
  );
  if (playlist) {
    const p =
      playlists.find((p) => normalize(p.title) === playlist[1]) ??
      playlists.find((p) => similarity(p.title, playlist[1]) > 0.85);
    return p ? { type: "playlist", id: p.id } : { type: "unknown" };
  }
  const video = n.match(
    /^(?:pon|reproduce|play) (?:el |the )?(?:video|concierto|concert|en vivo|live) (?:de |of )?(.+)$/,
  );
  if (video) return { type: "youtube", query: video[1] + " live" };
  const album = n.match(/^(?:pon|reproduce|play|escuchar?) (?:el |la )?(?:album|disco|lp|ep) (.+?)(?: (?:de|by) (.+))?$/);
  if (album)
    return { type: "album", query: [album[1], album[2]].filter(Boolean).join(" "), title: album[1], artist: album[2], platform };
  const vibe = n.match(/^(?:pon|reproduce|play) (?:algo|something) (.+)$/);
  if (vibe) return { type: "vibe", query: vibe[1] };
  const song = n.match(/^(?:pon|reproduce|play) (.+?) (?:de|by) (.+)$/);
  if (song)
    return {
      type: "track",
      query: `${song[1]} ${song[2]}`,
      title: song[1],
      artist: song[2],
      platform,
    };
  const artist = n.match(/^(?:pon|reproduce|play) (.+)$/);
  return artist ? { type: "artist", query: artist[1], platform } : { type: "unknown" };
}
