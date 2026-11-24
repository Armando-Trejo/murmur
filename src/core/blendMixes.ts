import { Auth, Voice, isNative } from "../native";
import { db } from "./db";
import { normalize } from "./FanUploadParser";
import { listeningStats } from "./musicOrder";
import { unwrapSpotifyTrack } from "./SpotifyLibrary";
import { creditedArtists } from "../components/ArtistProfile";
import type { Playlist, QueueItem } from "./types";

/**
 * Mezclas MURMUR: playlists that join what each provider's algorithm knows about you.
 *
 * - Spotify: your top tracks and top artists (with their genres).
 * - YouTube Music: your personalised Home, and the radio YouTube builds from your songs.
 * - MURMUR: what you actually finished listening to here.
 *
 * Genres are grouped into families; when the on-device sentence model is downloaded it places
 * genres no keyword recognises, otherwise a keyword table does. Nothing leaves the phone except the
 * provider requests the app already makes.
 */
export interface BlendMix {
  id: string;
  title: string;
  subtitle: string;
  tracks: QueueItem[];
  covers: string[];
  /** How many songs came from each provider. */
  spotify: number;
  youtube: number;
}

const FAMILIES: [string, string[]][] = [
  ["Punk y hardcore", ["punk", "hardcore", "emo", "ska"]],
  ["Metal", ["metal", "grindcore", "doom", "thrash", "djent"]],
  ["Rock", ["rock", "grunge", "garage", "shoegaze", "psych"]],
  ["Indie y alternativo", ["indie", "alternative", "alt ", "lo-fi", "bedroom", "dream pop"]],
  ["Hip hop y rap", ["hip hop", "rap", "trap", "drill", "boom bap"]],
  ["Urbano latino", ["reggaeton", "urbano", "latin trap", "dembow", "perreo"]],
  ["Regional mexicano", ["regional mexicano", "corrido", "banda", "norteño", "sierreño", "mariachi", "grupera"]],
  ["Cumbia y tropical", ["cumbia", "salsa", "bachata", "merengue", "tropical"]],
  ["Electrónica", ["electronic", "edm", "house", "techno", "trance", "dubstep", "drum and bass", "electro", "synthwave"]],
  ["Pop", ["pop", "k-pop", "j-pop", "dance pop"]],
  ["R&B y soul", ["r&b", "soul", "funk", "neo soul", "motown"]],
  ["Jazz y blues", ["jazz", "blues", "swing", "bossa"]],
  ["Folk y acústico", ["folk", "acoustic", "singer-songwriter", "country", "americana", "trova"]],
  ["Clásica e instrumental", ["classical", "orchestra", "piano", "ambient", "soundtrack", "instrumental"]],
];

export function keywordFamily(genre: string): string | undefined {
  const g = " " + genre.toLowerCase() + " ";
  for (const [family, words] of FAMILIES) if (words.some((w) => g.includes(w))) return family;
}

/** Same song on either provider: cleaned title + first credited artist. */
export function songKey(track: Pick<QueueItem, "title" | "artist">) {
  const title = normalize(track.title.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, ""));
  return title + "|" + normalize(creditedArtists(track.artist)[0] ?? track.artist);
}

/**
 * Round-robin across sources, skipping repeats of the same song and keeping one artist from playing
 * twice in a row when another choice exists.
 */
export function blend(lists: QueueItem[][], limit: number, exclude = new Set<string>()) {
  const queues = lists.map((list) => [...list]);
  const out: QueueItem[] = [];
  const seen = new Set(exclude);
  let guard = 0;
  while (out.length < limit && queues.some((q) => q.length) && guard++ < 5000) {
    for (const queue of queues) {
      if (out.length >= limit) break;
      const lastArtist = normalize(creditedArtists(out.at(-1)?.artist ?? "")[0] ?? "");
      let index = queue.findIndex((t) => !seen.has(songKey(t)) && normalize(creditedArtists(t.artist)[0] ?? "") !== lastArtist);
      if (index < 0) index = queue.findIndex((t) => !seen.has(songKey(t)));
      if (index < 0) { queue.length = 0; continue; }
      const [track] = queue.splice(index, 1);
      seen.add(songKey(track));
      out.push(track);
    }
  }
  return out;
}

function mix(id: string, title: string, subtitle: string, tracks: QueueItem[]): BlendMix | undefined {
  if (tracks.length < 8) return;
  const covers = [...new Set(tracks.map((t) => t.artworkUrl).filter((u): u is string => !!u))].slice(0, 4);
  return {
    id, title, subtitle, tracks, covers,
    spotify: tracks.filter((t) => t.source === "spotify").length,
    youtube: tracks.filter((t) => t.source === "youtube").length,
  };
}

async function settle<T>(promise: Promise<T>): Promise<T | undefined> {
  try { return await promise; } catch { return undefined; }
}

const spotifyTracks = (items: unknown) =>
  (Array.isArray(items) ? items : []).map(unwrapSpotifyTrack).filter((t): t is QueueItem => !!t);

/** Families for genres the keyword table misses, using the local sentence model when it is installed. */
async function semanticFamilies(genres: string[]) {
  const result = new Map<string, string>();
  const unknown = genres.filter((g) => !keywordFamily(g)).slice(0, 12);
  for (const genre of unknown) {
    const ranked = await settle(Voice.rankTags({ query: genre, tags: FAMILIES.map(([name]) => name) }));
    const best = ranked?.ranked?.[0];
    if (best && best.score > 0.35) result.set(genre, best.text);
  }
  return result;
}

const CACHE_KEY = "blend:v1";
const FRESH_MS = 12 * 60 * 60 * 1000;

export async function cachedBlendMixes(): Promise<{ at: number; mixes: BlendMix[] } | undefined> {
  const cached = await db.settings.get(CACHE_KEY);
  return cached?.value as { at: number; mixes: BlendMix[] } | undefined;
}

export async function generateBlendMixes(force = false): Promise<BlendMix[]> {
  const cached = await cachedBlendMixes();
  if (!force && cached && Date.now() - cached.at < FRESH_MS && cached.mixes.length) return cached.mixes;
  if (!isNative) return cached?.mixes ?? [];

  const [shortTop, mediumTop, artistsData, home, history, library] = await Promise.all([
    settle(Auth.spotifyRequest({ path: "/me/top/tracks?time_range=short_term&limit=30" })),
    settle(Auth.spotifyRequest({ path: "/me/top/tracks?time_range=medium_term&limit=30" })),
    settle(Auth.spotifyRequest({ path: "/me/top/artists?time_range=medium_term&limit=20" })),
    settle(Auth.youtubeHome()),
    db.history.toArray(),
    db.tracks.toArray(),
  ]);
  const spShort = spotifyTracks(shortTop?.data?.items);
  const spMedium = spotifyTracks(mediumTop?.data?.items);
  const topArtists: { name: string; genres: string[] }[] = (artistsData?.data?.items ?? [])
    .filter((a: { name?: string }) => typeof a?.name === "string")
    .map((a: { name: string; genres?: string[] }) => ({ name: a.name, genres: a.genres ?? [] }));
  const ytHome = (home?.shelves ?? []).flatMap((shelf) => shelf.items.flatMap((item) => (item.track ? [item.track] : [])));

  // What you really listen to in MURMUR, most played first.
  const stats = listeningStats(history);
  const byId = new Map(library.map((t) => [t.id, t]));
  const local = Object.entries(stats).sort((a, b) => b[1].plays - a[1].plays)
    .flatMap(([id]) => (byId.get(id) ? [byId.get(id)!] : [])).slice(0, 40);

  // YouTube's own algorithm: the radio it builds after a song you like.
  const seeds = [...local.filter((t) => t.source === "youtube" && t.videoId), ...ytHome.filter((t) => t.videoId)]
    .filter((t, i, all) => all.findIndex((x) => x.videoId === t.videoId) === i).slice(0, 4);
  const radios = await Promise.all(seeds.map(async (seed) => ({
    seed,
    tracks: (await settle(Auth.youtubeCollection({ id: "RDAMVM" + seed.videoId })))?.tracks?.filter((t) => t.videoId !== seed.videoId) ?? [],
  })));

  // Genre families of the artists you play most, placed by keywords or by the on-device model.
  const allGenres = [...new Set(topArtists.flatMap((a) => a.genres))];
  const semantic = await semanticFamilies(allGenres);
  const familyOf = (genre: string) => keywordFamily(genre) ?? semantic.get(genre);
  const artistFamily = new Map<string, string>();
  const familyWeight = new Map<string, number>();
  topArtists.forEach((artist, rank) => {
    const counts = new Map<string, number>();
    for (const g of artist.genres) { const f = familyOf(g); if (f) counts.set(f, (counts.get(f) ?? 0) + 1); }
    const family = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!family) return;
    artistFamily.set(normalize(artist.name), family);
    familyWeight.set(family, (familyWeight.get(family) ?? 0) + (20 - rank));
  });
  const trackFamily = (t: QueueItem) => creditedArtists(t.artist).map((a) => artistFamily.get(normalize(a))).find(Boolean);

  // Spotify catalogue around your top artists (its popularity order).
  const spArtistTracks = (await Promise.all(topArtists.slice(0, 5).map(async (artist) =>
    spotifyTracks((await settle(Auth.spotifyRequest({
      path: "/search?type=track&limit=8&q=" + encodeURIComponent(`artist:"${artist.name}"`),
    })))?.data?.tracks?.items),
  ))).flat();

  const radioTracks = radios.flatMap((r) => r.tracks);
  const mixes: BlendMix[] = [];
  const daily = mix("blend-daily", "Tu mezcla MURMUR",
    "Lo que más escuchas en Spotify, YouTube y aquí, con descubrimientos de ambos",
    blend([spShort, ytHome, local, radioTracks.slice(0, 15), spMedium], 40));
  if (daily) mixes.push(daily);

  for (const [family] of [...familyWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    const fromSpotify = [...spShort, ...spMedium, ...spArtistTracks].filter((t) => trackFamily(t) === family);
    const fromYouTube = [
      ...radios.filter((r) => trackFamily(r.seed) === family).flatMap((r) => r.tracks),
      ...[...ytHome, ...local, ...radioTracks].filter((t) => trackFamily(t) === family),
    ];
    const made = mix("blend-" + normalize(family).replace(/\s+/g, "-"), "Mezcla · " + family,
      "Spotify y YouTube Music sobre tu " + family.toLowerCase(), blend([fromSpotify, fromYouTube], 30));
    if (made) mixes.push(made);
  }

  // Only songs you have never saved or played: each provider's algorithm, interleaved.
  const known = new Set(library.filter((t) => t.saved || stats[t.id]).map(songKey));
  const discovery = mix("blend-discover", "Descubrimiento cruzado",
    "Canciones nuevas para ti que recomiendan ambos algoritmos",
    blend([radioTracks, spArtistTracks, ytHome], 30, known));
  if (discovery) mixes.push(discovery);

  for (const r of radios.slice(0, 2)) {
    const made = mix("blend-radio-" + r.seed.videoId, "Radio de " + r.seed.title,
      "YouTube Music a partir de " + r.seed.artist + ", con tus favoritas de Spotify",
      blend([r.tracks, spShort.filter((t) => trackFamily(t) && trackFamily(t) === trackFamily(r.seed))], 30));
    if (made) mixes.push(made);
  }

  if (mixes.length) await db.settings.put({ key: CACHE_KEY, value: { at: Date.now(), mixes } });
  return mixes.length ? mixes : cached?.mixes ?? [];
}

/** Keeps a mix as a hybrid playlist in the library (songs are stored, nothing is downloaded). */
export async function saveBlendMix(blendMix: BlendMix) {
  const day = new Date().toISOString().slice(0, 10);
  const playlist: Playlist = {
    id: "mix:" + blendMix.id + ":" + day,
    title: blendMix.title + " · " + new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date()),
    source: "hybrid",
    kind: "playlist",
    trackIds: blendMix.tracks.map((t) => t.id),
    artworkUrl: blendMix.covers[0],
    subtitle: blendMix.subtitle,
  };
  await db.transaction("rw", db.tracks, db.playlists, async () => {
    for (const track of blendMix.tracks) {
      const existing = await db.tracks.get(track.id);
      await db.tracks.put({ ...track, ...existing, tags: existing?.tags ?? track.tags ?? [], saved: existing?.saved ?? false });
    }
    await db.playlists.put(playlist);
  });
  return playlist;
}
