import { Auth, isNative, Voice } from "../native";
import { creditedArtists } from "../components/ArtistProfile";
import { normalize } from "./FanUploadParser";
import { similarity } from "./SourceResolver";
import { youtubeTwin } from "./spotifyBridge";
import type { QueueItem } from "./types";

/** A link to the song on one platform, ready for Android's share sheet. */
export interface ShareLink {
  platform: "youtube" | "spotify";
  label: string;
  url: string;
}

const lead = (artist: string) => creditedArtists(artist)[0] ?? artist;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;

export const youtubeUrl = (videoId: string) => "https://music.youtube.com/watch?v=" + videoId;
export function spotifyUrl(track: Pick<QueueItem, "spotifyUri" | "id">) {
  const id = track.spotifyUri?.match(/^spotify:track:([A-Za-z0-9]{10,40})$/)?.[1]
    ?? track.id.match(/^(?:spotify:|sp:)?(?:track:)?([A-Za-z0-9]{22})$/)?.[1];
  return id ? "https://open.spotify.com/track/" + id : undefined;
}

/** The same song on Spotify, only when title and artist really match (never a guess). */
async function spotifyMatch(track: QueueItem): Promise<string | undefined> {
  if (!isNative) return undefined;
  const q = `track:"${track.title.replace(/"/g, "")}" artist:"${lead(track.artist).replace(/"/g, "")}"`;
  const found = await Auth.spotifyRequest({ path: "/search?type=track&limit=5&q=" + encodeURIComponent(q) }).catch(() => undefined);
  const items = (found?.data?.tracks?.items ?? []) as { id?: string; name?: string; artists?: { name?: string }[] }[];
  for (const item of items) {
    if (!item?.id || !item.name) continue;
    const artist = item.artists?.[0]?.name ?? "";
    if (similarity(item.name, track.title) >= 0.8 && normalize(artist) && similarity(artist, lead(track.artist)) >= 0.75)
      return "https://open.spotify.com/track/" + item.id;
  }
  return undefined;
}

/**
 * Links to the song on YouTube Music and on Spotify, only those that exist: the song's own link,
 * and the other platform's when MURMUR finds the very same song there.
 */
export async function shareLinks(track: QueueItem): Promise<ShareLink[]> {
  const links: ShareLink[] = [];
  let video = track.videoId && VIDEO.test(track.videoId) ? track.videoId : undefined;
  let spotify = spotifyUrl(track);
  const [twin, match] = await Promise.all([
    !video && track.source === "spotify" ? youtubeTwin(track).catch(() => undefined) : undefined,
    !spotify ? spotifyMatch(track) : undefined,
  ]);
  video ??= twin?.videoId;
  spotify ??= match;
  if (video) links.push({ platform: "youtube", label: "YouTube Music", url: youtubeUrl(video) });
  if (spotify) links.push({ platform: "spotify", label: "Spotify", url: spotify });
  return links;
}

/** The text that goes to WhatsApp, Instagram, correo…: song, artist and the link. */
export const shareMessage = (track: Pick<QueueItem, "title" | "artist">, link: ShareLink) =>
  `${track.title} · ${track.artist}\n${link.url}`;

export async function shareTrack(track: QueueItem, link: ShareLink) {
  const text = shareMessage(track, link);
  if (isNative) return Voice.shareText({ title: "Compartir canción", text });
  if (navigator.share) return navigator.share({ title: track.title, text: `${track.title} · ${track.artist}`, url: link.url });
  await navigator.clipboard?.writeText(text);
}
