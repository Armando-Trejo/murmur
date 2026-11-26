import type { FeedShelf } from "../native";

/**
 * Each reload of «Para ti» should look new, like pulling to refresh in Spotify or YouTube Music.
 * The providers answer almost the same feed twice in a row, so MURMUR varies what it shows:
 * a different mood of YouTube Music each time, the sections in another order and other songs first
 * inside each one, and another slice of your Spotify favourites.
 */
const ROUND_KEY = "murmur.feedRound";

/** A new number on every load (kept between sessions, so opening the app also shows something new). */
export function nextFeedRound() {
  if (typeof localStorage === "undefined") return 0;
  const round = (Number(localStorage.getItem(ROUND_KEY)) || 0) + 1;
  try { localStorage.setItem(ROUND_KEY, String(round)); } catch { /* ignore */ }
  return round;
}

const rotate = <T,>(items: T[], by: number) => {
  if (items.length < 2) return items;
  const k = ((by % items.length) + items.length) % items.length;
  return [...items.slice(k), ...items.slice(0, k)];
};

/** The first section stays (it is what you play the most); the rest change order and lead songs. */
export function rotateShelves(shelves: FeedShelf[], round: number): FeedShelf[] {
  if (shelves.length < 2) return shelves;
  const [first, ...rest] = shelves;
  return [first, ...rotate(rest, round)].map((shelf, index) => ({
    ...shelf,
    // Long carousels start on other cards; short ones (mixes, recaps) keep their order.
    items: index > 0 && shelf.items.length > 6 ? rotate(shelf.items, round * 4) : shelf.items,
  }));
}

/** Moods worth a section on Inicio (podcasts and sleep are not «para ti» music). */
export const feedMoods = (chips: { title: string; params: string }[]) =>
  chips.filter((chip) => chip.params && !/p[oó]dcast|dormir|sleep/i.test(chip.title));

/**
 * One or two sections from this round's mood, titled with it («Energía · Rap»), without repeating a
 * section the main feed already has.
 */
export function moodShelves(mood: string, shelves: FeedShelf[], existing: FeedShelf[], max = 2): FeedShelf[] {
  const taken = new Set(existing.map((shelf) => shelf.title.toLowerCase()));
  return shelves
    .filter((shelf) => shelf.items.length >= 4 && !taken.has(shelf.title.toLowerCase()) && !/personalizad/i.test(shelf.title))
    .slice(0, max)
    .map((shelf) => ({ ...shelf, title: `${mood} · ${shelf.title}` }));
}

/** `size` songs from a bigger pool, a different slice each round. */
export function pickWindow<T>(pool: T[], round: number, size: number): T[] {
  if (pool.length <= size) return pool;
  return rotate(pool, round * size).slice(0, size);
}
