import { normalize } from "./FanUploadParser";
import { creditedArtists } from "../components/ArtistProfile";
import type { ListeningStats } from "./musicOrder";
import type { QueueItem } from "./types";

/**
 * Title key that still tells versions apart: remaster years and featured artists go, but live,
 * acoustic, remix, demo… stay, so "Bullet" and "Bullet (Live)" are two songs.
 */
export function versionKey(track: Pick<QueueItem, "title" | "artist">) {
  const title = track.title
    .replace(/\s*[([](?:feat|ft|with|con)\.?\s[^)\]]*[)\]]/gi, "")
    .replace(/\s+(?:feat|ft)\.?\s.*$/i, "")
    .replace(/\s*[([]?\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?\s*[)\]]?/gi, "")
    .replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?.*$/i, "");
  return normalize(title) + "|" + normalize(creditedArtists(track.artist)[0] ?? track.artist);
}

const playable = (t: QueueItem, stats: ListeningStats) =>
  (stats[t.id]?.plays ?? 0) * 10 + (t.offlinePath ? 5 : 0) + (t.source === "youtube" ? 1 : 0);

/**
 * One entry per song across Spotify and YouTube. Entries merge only when title, main artist and
 * length (±4 s, or unknown) agree; the kept one is the most played, then a downloaded or YouTube
 * copy. The order of the input list is preserved.
 */
export function uniqueSongs(list: QueueItem[], stats: ListeningStats = {}) {
  const groups = new Map<string, QueueItem[][]>();
  for (const track of list) {
    const key = versionKey(track);
    const buckets = groups.get(key) ?? [];
    const near = buckets.find((bucket) => bucket.some((other) =>
      !(track.duration > 0) || !(other.duration > 0) || Math.abs(other.duration - track.duration) <= 4));
    if (near) near.push(track);
    else buckets.push([track]);
    groups.set(key, buckets);
  }
  const keep = new Set<string>();
  const copies = new Map<string, number>();
  for (const buckets of groups.values())
    for (const bucket of buckets) {
      const best = [...bucket].sort((a, b) => playable(b, stats) - playable(a, stats))[0];
      keep.add(best.id);
      if (bucket.length > 1) copies.set(best.id, bucket.length);
    }
  return { songs: list.filter((t) => keep.has(t.id)), copies };
}
