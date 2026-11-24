import type { Chapter } from './types';
const noise = /\b(?:official(?:\s+(?:music\s+)?(?:video|audio))?|music video|lyrics?|hq|hd|4k|1080p|720p|sub\s*(?:espa[nñ]ol|english)|audio oficial|video oficial)\b/gi;
export const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
export function parseChapters(description: string, duration: number): Chapter[] {
  if (duration <= 900) return [];
  const chapters = description.split('\n').flatMap(line => {
    const m = line.match(/(?:^|\s|\[|\()((?:\d{1,3}:)?\d{1,3}:\d{2})(?:\]|\))?/);
    if (!m) return [];
    const segments = m[1].split(':').map(Number);
    if (segments.at(-1)! >= 60 || (segments.length === 3 && segments[1] >= 60)) return [];
    const seconds = segments.reduce((a, n) => a * 60 + n, 0);
    if (seconds >= duration) return [];
    const title = line.replace(m[0], ' ').replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, '').trim();
    return title ? [{ title, positionMs: seconds * 1000 }] : [];
  });
  return [...new Map(chapters.map(c => [c.positionMs, c])).values()].sort((a, b) => a.positionMs - b.positionMs);
}
export function parseFanUpload(raw: string, description = '', duration = 0) {
  const tagPatterns: [string, RegExp][] = [['unreleased', /unreleased|in[eé]dit[ao]/i], ['demo', /\bdemo\b/i], ['live', /\blive\b|en vivo|concierto/i], ['bootleg', /bootleg/i], ['full set', /full set/i], ['session', /session|sesi[oó]n/i], ['rare', /\brare\b|rareza/i], ['remix', /remix|rework/i]];
  const tags = tagPatterns.filter(([, r]) => r.test(raw)).map(([tag]) => tag);
  const cleaned = raw.replace(noise, '').replace(/[\[(]\s*[\])]/g, '').replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(/\s*[-–—|:]\s*/).filter(Boolean);
  return { title: parts.length > 1 ? parts.slice(1).join(' · ') : cleaned, candidateArtist: parts.length > 1 ? parts[0].trim() : undefined, artist: parts.length > 1 ? parts[0].trim() : 'Artista por identificar', tags, forceYouTube: tags.length > 0, chapters: parseChapters(description, duration) };
}
