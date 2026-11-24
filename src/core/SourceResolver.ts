import { normalize, parseFanUpload } from './FanUploadParser';
import type { QueueItem } from './types';
export function similarity(a: string, b: string): number {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1])); row = next; }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}
export function resolveSource(track: QueueItem, candidates: QueueItem[]): QueueItem {
  if (track.tags.some(t => /live|remix|demo|unreleased|bootleg|session|rare|full set/.test(t)) || parseFanUpload(track.title).forceYouTube) return { ...track, source: 'youtube' };
  const match = candidates.find(c => c.source === 'spotify' && c.duration > 0 && track.duration > 0 && Math.abs(c.duration - track.duration) <= 5 && similarity(c.title, track.title) > .85 && similarity(c.artist, track.artist) > .85);
  return match ? { ...match, tags: track.tags } : track;
}
