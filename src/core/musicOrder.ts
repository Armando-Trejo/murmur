import type { HistoryEntry, QueueItem } from "./types";
export type MusicOrder = "popular" | "listening" | "relevance" | "title";
export type ListeningStats = Record<string, { plays: number; seconds: number }>;
export function listeningStats(entries: HistoryEntry[]): ListeningStats {
  const result: ListeningStats = {};
  for (const entry of entries) {
    if (!Number.isFinite(entry.seconds) || entry.seconds < 30) continue;
    const score = (result[entry.trackId] ??= { plays: 0, seconds: 0 });
    score.plays++;
    score.seconds += entry.seconds;
  }
  return result;
}
export function orderMusic(
  tracks: QueueItem[],
  order: MusicOrder,
  stats: ListeningStats = {},
): QueueItem[] {
  if (order === "popular") {
    const result = [...tracks];
    const metric = (track: QueueItem) =>
      track.source === "youtube" ? track.viewCount : track.popularity;
    for (const source of ["spotify", "youtube"]) {
      const slots = tracks.flatMap((track, index) => {
        const value = metric(track);
        return track.source === source &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0
          ? [index]
          : [];
      });
      const sorted = slots
        .map((index) => tracks[index])
        .sort((a, b) => metric(b)! - metric(a)!);
      slots.forEach((slot, index) => {
        result[slot] = sorted[index];
      });
    }
    return result;
  }
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((a, b) => {
      let delta = 0;
      if (order === "listening")
        delta =
          (stats[b.track.id]?.plays || 0) - (stats[a.track.id]?.plays || 0) ||
          (stats[b.track.id]?.seconds || 0) - (stats[a.track.id]?.seconds || 0);
      if (order === "title")
        delta = a.track.title.localeCompare(b.track.title, "es");
      return delta || a.index - b.index;
    })
    .map((entry) => entry.track);
}
