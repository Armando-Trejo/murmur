import { normalize } from "./FanUploadParser";
import { creditedArtists } from "../components/ArtistProfile";

/**
 * Free-form music requests ("ponme esa de Miranda que se llama Bailarina", "quiero oír Enjambre",
 * "la de afuera caifanes"). Instead of a grammar, the words the user said are compared with what the
 * catalogues return: the candidate whose name (and artist) is best covered by the sentence wins.
 * Spotify and YouTube Music search already understand loose wording, typos and partial titles.
 */
export type Candidate =
  | { kind: "track"; title: string; artist: string; popularity?: number; ref: unknown }
  | { kind: "artist"; name: string; popularity?: number; ref: unknown }
  | { kind: "album"; title: string; artist: string; ref: unknown };

const STOP = new Set(["de", "del", "la", "el", "los", "las", "y", "a", "the", "by", "con", "en", "un", "una", "feat", "ft", "que", "se", "llama", "esa", "esta", "me", "mi"]);
export const words = (text: string) => normalize(text).split(" ").filter((w) => w && !STOP.has(w));

/** Share of `name`'s words the user said (tolerating one typo per long word). */
function covered(name: string, said: Set<string>) {
  const own = words(name);
  if (!own.length) return 0;
  let hit = 0;
  for (const w of own) {
    if (said.has(w)) { hit++; continue; }
    if (w.length >= 5 && [...said].some((s) => s.length >= 4 && (s.startsWith(w.slice(0, 4)) && Math.abs(s.length - w.length) <= 2))) hit += 0.8;
  }
  return hit / own.length;
}

/** Score 0..1 of how well a candidate explains the whole sentence. */
export function explain(candidate: Candidate, query: string) {
  const said = new Set(words(query));
  const total = Math.max(1, said.size);
  if (candidate.kind === "artist") {
    const name = covered(candidate.name, said);
    // The artist must be fully named and be most of what was said.
    return name * Math.min(1, words(candidate.name).length / total + 0.15);
  }
  const lead = creditedArtists(candidate.artist)[0] ?? candidate.artist;
  const title = covered(candidate.title.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, ""), said);
  const artist = covered(lead, said);
  const used = words(candidate.title.replace(/\s*[([][^)\]]*[)\]]/g, "")).length + (artist > 0.5 ? words(lead).length : 0);
  const share = Math.min(1, used / total);
  return title * 0.7 * share + (artist > 0.5 ? 0.3 : title >= 1 ? 0.12 : 0);
}

/**
 * The best interpretation, or undefined when nothing fits well enough (then MURMUR plays the
 * catalogue's own top hit for the words). Ties go to the song, then the artist, then the album.
 */
export function interpret(candidates: Candidate[], query: string) {
  const order = { track: 0, artist: 1, album: 2 };
  let best: Candidate | undefined;
  let score = 0;
  for (const c of candidates) {
    const s = explain(c, query) + (c.kind === "track" ? (c.popularity ?? 0) / 2000 : c.kind === "artist" ? (c.popularity ?? 0) / 4000 : 0);
    if (s > score + 0.02 || (best && Math.abs(s - score) <= 0.02 && order[c.kind] < order[best.kind])) {
      if (s > score) score = s;
      best = c;
    }
  }
  return score >= 0.55 ? best : undefined;
}
