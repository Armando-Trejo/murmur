import { db } from "./db";

export const RECENT_SEARCHES_KEY = "search.recent";
const LIMIT = 8;

/** Newest first, case-insensitive de-duplication, bounded length. */
export function pushRecent(list: string[], query: string, limit = LIMIT) {
  const value = query.trim().replace(/\s+/g, " ").slice(0, 120);
  if (value.length < 2) return list;
  const key = value.toLocaleLowerCase("es");
  return [value, ...list.filter(item => item.toLocaleLowerCase("es") !== key)].slice(0, limit);
}

export function removeRecent(list: string[], query: string) {
  return list.filter(item => item !== query);
}

export function validRecent(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length < 200).slice(0, LIMIT) : [];
}

export async function loadRecentSearches() {
  return validRecent((await db.settings.get(RECENT_SEARCHES_KEY))?.value);
}

export async function saveRecentSearches(list: string[]) {
  await db.settings.put({ key: RECENT_SEARCHES_KEY, value: list });
}
