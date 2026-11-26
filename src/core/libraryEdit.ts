import { Audio, isNative } from "../native";
import { db, playlistTracks, saveTrack } from "./db";
import { normalize } from "./FanUploadParser";
import type { ArtSnapshot, Playlist, QueueItem } from "./types";

/**
 * Everything the owner can edit in the library: playlists and albums (create, rename, remove songs,
 * delete), songs (like, unlike, edit, delete; songs are never created) and the rule that an album's
 * cover is the cover of its songs. All of it is local and survives the Spotify and YouTube syncs:
 * what was removed stays removed and what was renamed keeps its name.
 */

const DELETED_KEY = "library:deletedPlaylists";

export const isAlbumList = (p?: Pick<Playlist, "kind">) => p?.kind === "album";
/** Collections MURMUR rebuilds on its own (daily and weekly mixes): not edited by hand. */
export const isAutoList = (id: string) => id.startsWith("local:mix:");

/* ---------- Deleted collections (so a sync does not bring them back) ---------- */

export async function deletedPlaylists(): Promise<Record<string, number>> {
  return ((await db.settings.get(DELETED_KEY))?.value as Record<string, number> | undefined) ?? {};
}
async function markDeleted(id: string, deleted: boolean) {
  const all = await deletedPlaylists();
  if (deleted) all[id] = Date.now();
  else if (!(id in all)) return;
  else delete all[id];
  await db.settings.put({ key: DELETED_KEY, value: all });
}
/** The owner saved it again on purpose. */
export const forgetDeleted = (id: string) => markDeleted(id, false);

/* ---------- Merging what a provider sends with what the owner changed ---------- */

/** A synced or re-imported song over the stored one: the owner's likes, edits, cover and download stay. */
export function mergeSyncedTrack(existing: QueueItem | undefined, incoming: QueueItem): QueueItem {
  if (!existing) return incoming;
  const merged: QueueItem = {
    ...existing,
    ...incoming,
    tags: [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])],
    offlinePath: existing.offlinePath ?? incoming.offlinePath,
  };
  if (existing.edits) Object.assign(merged, existing.edits);
  if (existing.unliked || existing.deleted) merged.saved = false;
  // The album's (or the owner's) cover stays; the provider's new one is kept to restore later.
  if (existing.coverAlbum) {
    merged.ownArt = { ...existing.ownArt, artworkUrl: incoming.artworkUrl ?? existing.ownArt?.artworkUrl };
    merged.artworkUrl = existing.artworkUrl;
    merged.customArtwork = existing.customArtwork;
    merged.artworkFrame = existing.artworkFrame;
  }
  return merged;
}

/** A synced collection over the stored one; undefined when the owner deleted it (it stays deleted). */
export function mergeSyncedPlaylist(existing: Playlist | undefined, incoming: Playlist, deleted: Record<string, number> = {}): Playlist | undefined {
  if (incoming.id in deleted) return undefined;
  if (!existing) return { ...incoming, addedAt: incoming.addedAt ?? Date.now() };
  const removed = new Set(existing.removedIds ?? []);
  const merged: Playlist = {
    ...existing,
    ...incoming,
    trackIds: incoming.trackIds.filter((id) => !removed.has(id)),
    customArtwork: existing.customArtwork,
    artworkFrame: existing.artworkFrame,
    artworkUrl: incoming.artworkUrl ?? existing.artworkUrl,
    removedIds: existing.removedIds,
    addedAt: existing.addedAt,
  };
  if (existing.edited?.title) merged.title = existing.title;
  if (existing.edited?.artist) merged.artist = existing.artist;
  if (existing.edited?.year) merged.year = existing.year;
  if (existing.edited?.kind) merged.kind = existing.kind;
  return merged;
}

/* ---------- Album covers ---------- */

const snapshot = (t: ArtSnapshot): ArtSnapshot => ({ artworkUrl: t.artworkUrl, customArtwork: t.customArtwork, artworkFrame: t.artworkFrame });
const sameArt = (a: ArtSnapshot, b: ArtSnapshot) =>
  a.artworkUrl === b.artworkUrl && a.customArtwork === b.customArtwork && JSON.stringify(a.artworkFrame) === JSON.stringify(b.artworkFrame);

/** The album's cover: the owner's image, else the provider's, else the first of its songs that has one. */
export function albumArt(album: Playlist, songs: QueueItem[]): ArtSnapshot {
  const url = album.artworkUrl ?? songs.map((t) => (t.coverAlbum ? t.ownArt?.artworkUrl : t.artworkUrl)).find(Boolean);
  return { artworkUrl: url, customArtwork: album.customArtwork, artworkFrame: album.artworkFrame };
}

/**
 * The song with its album's cover (its own is kept aside), or undefined when nothing changes.
 * A song on two albums keeps the one that carries its album name, unless `force` (the owner just
 * changed this album's cover).
 */
export function coveredBy(track: QueueItem, album: Playlist, art: ArtSnapshot, force = false, otherExists = false): QueueItem | undefined {
  if (!art.artworkUrl && !art.customArtwork) return undefined;
  if (!force && otherExists && track.coverAlbum && track.coverAlbum !== album.id && normalize(track.album ?? "") !== normalize(album.title)) return undefined;
  const own = track.coverAlbum ? track.ownArt ?? {} : snapshot(track);
  const next: ArtSnapshot = { artworkUrl: art.artworkUrl ?? own.artworkUrl, customArtwork: art.customArtwork, artworkFrame: art.artworkFrame };
  if (track.coverAlbum === album.id && sameArt(track, next)) return undefined;
  return { ...track, ...next, ownArt: own, coverAlbum: album.id };
}

/** The song with the cover it had before the album's. */
export function uncovered(track: QueueItem): QueueItem {
  const { coverAlbum: _album, ownArt, ...rest } = track;
  return { ...rest, ...(ownArt ?? {}) };
}

type CoverListener = (changed: QueueItem[]) => void;
const listeners = new Set<CoverListener>();
/** The player's queue follows the changes (covers, names). */
export function onSongsChanged(listener: CoverListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const announce = (changed: QueueItem[]) => { if (changed.length) listeners.forEach((l) => l(changed)); };

/** Gives every song of an album its cover. Returns the songs that changed. */
export async function applyAlbumCover(albumId: string, force = false): Promise<QueueItem[]> {
  const album = await db.playlists.get(albumId);
  if (!album || !isAlbumList(album)) return [];
  const songs = await playlistTracks(album);
  const art = albumArt(album, songs);
  if (!album.artworkUrl && art.artworkUrl) await db.playlists.update(albumId, { artworkUrl: art.artworkUrl });
  const albums = new Set((await db.playlists.toArray()).filter(isAlbumList).map((p) => p.id));
  const changed = songs.flatMap((t) => coveredBy(t, album, art, force, !!t.coverAlbum && albums.has(t.coverAlbum)) ?? []);
  if (changed.length) await db.tracks.bulkPut(changed);
  announce(changed);
  return changed;
}

/** At start and after a sync: every album's songs carry its cover. */
export async function applyAllAlbumCovers() {
  const albums = (await db.playlists.toArray()).filter(isAlbumList);
  for (const album of albums) await applyAlbumCover(album.id);
}

/** Songs that stop belonging to an album get their own cover back (or another album's). */
async function releaseCovers(albumId: string, ids?: string[]) {
  const all = ids ? (await db.tracks.bulkGet(ids)).filter((t): t is QueueItem => !!t) : await db.tracks.filter((t) => t.coverAlbum === albumId).toArray();
  const changed = all.filter((t) => t.coverAlbum === albumId).map(uncovered);
  if (!changed.length) return;
  // bulkPut replaces the whole record, so the album's cover fields do disappear.
  await db.tracks.bulkPut(changed);
  announce(changed);
  const back = new Set(changed.map((t) => t.id));
  const others = (await db.playlists.toArray()).filter((p) => isAlbumList(p) && p.id !== albumId && p.trackIds.some((id) => back.has(id)));
  for (const album of others) await applyAlbumCover(album.id);
}

/** The cover editor saved: on an album it reaches all its songs. */
export async function setCover(kind: "playlist" | "track", id: string, change: Pick<ArtSnapshot, "customArtwork" | "artworkFrame">) {
  const cover = { customArtwork: change.customArtwork, artworkFrame: change.artworkFrame };
  if (kind === "playlist") {
    await db.playlists.update(id, cover);
    await applyAlbumCover(id, true);
    return;
  }
  const track = await db.tracks.get(id);
  if (!track) return;
  // "Restaurar" on a song of an album goes back to the album's cover, which is what it shows.
  const next: QueueItem = { ...track, ...cover };
  await db.tracks.put(next);
  announce([next]);
}

/* ---------- Collections: create, edit, remove songs, delete ---------- */

export interface CollectionDraft { title: string; artist?: string; year?: string }

const clean = (text: string | undefined, max = 100) => text?.replace(/\s+/g, " ").trim().slice(0, max) || undefined;

export async function createCollection(kind: "playlist" | "album", draft: CollectionDraft, songs: QueueItem[] = []): Promise<Playlist> {
  const title = clean(draft.title);
  if (!title) throw new Error(kind === "album" ? "Ponle nombre al álbum." : "Ponle nombre a la playlist.");
  const playlist: Playlist = {
    id: "local:" + crypto.randomUUID(), title, kind, source: "hybrid", trackIds: [], addedAt: Date.now(),
    ...(clean(draft.artist) ? { artist: clean(draft.artist) } : {}),
    ...(clean(draft.year, 4) ? { year: clean(draft.year, 4) } : {}),
  };
  await db.playlists.add(playlist);
  if (songs.length) await addSongs(playlist.id, songs);
  return (await db.playlists.get(playlist.id))!;
}

/** Renames and retags a collection; the names the owner typed are not overwritten by a sync. */
export async function editCollection(id: string, draft: CollectionDraft & { kind?: "playlist" | "album" }) {
  const current = await db.playlists.get(id);
  if (!current) throw new Error("Esta colección ya no existe.");
  const title = clean(draft.title);
  if (!title) throw new Error("El nombre no puede quedar vacío.");
  const artist = clean(draft.artist);
  const year = clean(draft.year, 4);
  const kind = draft.kind ?? (current.kind ?? "playlist");
  const edited = { ...current.edited };
  if (title !== current.title) edited.title = true;
  if (artist !== current.artist) edited.artist = true;
  if (year !== current.year) edited.year = true;
  if (kind !== (current.kind ?? "playlist")) edited.kind = true;
  await db.playlists.put({ ...current, title, artist, year, kind, edited });
  if (kind === "album") await applyAlbumCover(id);
  else if (current.kind === "album") await releaseCovers(id);
}

/** Adds songs to a playlist or an album (songs removed earlier come back). */
export async function addSongs(playlistId: string, songs: QueueItem[]) {
  await db.transaction("rw", [db.tracks, db.playlists, db.playlist_overrides], async () => {
    const playlist = await db.playlists.get(playlistId);
    if (!playlist) throw new Error("La playlist ya no existe.");
    const present = new Set((await playlistTracks(playlist)).map((t) => t.id));
    const ids: string[] = [];
    for (const song of songs) {
      const stored = await db.tracks.get(song.id);
      // Being in a playlist or an album is not a like.
      if (!stored) await db.tracks.put({ ...stripQueueFields(song), saved: false });
      else if (stored.deleted) await db.tracks.put({ ...stored, deleted: undefined });
      if (!present.has(song.id) && !ids.includes(song.id)) ids.push(song.id);
    }
    const removed = playlist.removedIds?.filter((id) => !songs.some((s) => s.id === id));
    if (playlist.source === "hybrid") await db.playlists.update(playlistId, { trackIds: [...playlist.trackIds, ...ids], removedIds: removed });
    else {
      // A provider's list is replaced by each sync: the owner's additions live beside it.
      await db.playlists.update(playlistId, { removedIds: removed });
      for (const [i, id] of ids.entries())
        await db.playlist_overrides.add({ spotify_playlist_id: playlistId, trackId: id, videoId: "", position: present.size + i });
    }
  });
  await applyAlbumCover(playlistId);
}

/** What only means something while a song waits in the queue. */
function stripQueueFields(song: QueueItem): QueueItem {
  const { queueId: _q, userQueued: _u, smart: _s, continuation: _c, mood: _m, moodKey: _k, moodAsked: _a, ...rest } = song;
  return rest;
}

/** Takes songs out of a playlist or an album. Likes are not touched. Returns what undoes it. */
export async function removeSongs(playlistId: string, ids: string[]): Promise<() => Promise<void>> {
  const gone = new Set(ids);
  const before = await db.playlists.get(playlistId);
  if (!before) return async () => {};
  const overrides = await db.playlist_overrides.where("spotify_playlist_id").equals(playlistId).and((o) => gone.has(o.trackId)).toArray();
  await db.transaction("rw", [db.playlists, db.playlist_overrides], async () => {
    await db.playlist_overrides.bulkDelete(overrides.map((o) => o.id!));
    await db.playlists.update(playlistId, {
      trackIds: before.trackIds.filter((id) => !gone.has(id)),
      removedIds: [...new Set([...(before.removedIds ?? []), ...ids])],
    });
  });
  await releaseCovers(playlistId, ids);
  return async () => {
    await db.transaction("rw", [db.playlists, db.playlist_overrides], async () => {
      await db.playlists.update(playlistId, { trackIds: before.trackIds, removedIds: before.removedIds });
      if (overrides.length) await db.playlist_overrides.bulkPut(overrides);
    });
    await applyAlbumCover(playlistId);
  };
}

/** Deletes a playlist or an album from MURMUR. Its songs and likes stay; Spotify and YouTube are not touched. */
export async function deleteCollection(id: string) {
  await releaseCovers(id);
  await db.transaction("rw", [db.playlists, db.playlist_overrides, db.settings], async () => {
    await db.playlist_overrides.where("spotify_playlist_id").equals(id).delete();
    await db.playlists.delete(id);
    await markDeleted(id, true);
  });
}

/* ---------- Songs: like, unlike, edit, delete (never create) ---------- */

export const isLiked = (t: QueueItem | undefined) => !!t && !t.deleted && t.saved !== false;

export async function likeSong(track: QueueItem) {
  const stored = await db.tracks.get(track.id);
  const base = stored ? { ...stored, unliked: undefined, deleted: undefined } : stripQueueFields(track);
  if (stored) await db.tracks.put(base);
  await saveTrack(base);
}

/** Takes a song out of «Guardadas». It stays in the playlists and albums that have it. */
export async function unlikeSong(id: string) {
  const stored = await db.tracks.get(id);
  if (!stored) return;
  await db.tracks.put({ ...stored, saved: false, unliked: true, tags: (stored.tags ?? []).filter((t) => t !== "liked") });
  // Spotify's «Tus Me Gusta» list is the likes themselves.
  const liked = await db.playlists.get("sp:liked");
  if (liked?.trackIds.includes(id)) await removeSongs("sp:liked", [id]);
}

/** Takes all of an album's (or playlist's) songs out of «Guardadas»; returns how many were there. */
export async function unlikeCollection(playlistId: string) {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) return 0;
  const liked = (await playlistTracks(playlist)).filter(isLiked);
  for (const t of liked) await unlikeSong(t.id);
  return liked.length;
}

/** Corrects a song's title, artist or album; a sync keeps the correction. */
export async function editSong(id: string, draft: { title: string; artist: string; album?: string }) {
  const stored = await db.tracks.get(id);
  if (!stored) throw new Error("Esta canción no está en tu biblioteca.");
  const title = clean(draft.title, 200);
  const artist = clean(draft.artist, 200);
  if (!title || !artist) throw new Error("La canción necesita título y artista.");
  const album = clean(draft.album, 200);
  const next: QueueItem = { ...stored, title, artist, album, edits: { title, artist, album } };
  await db.tracks.put(next);
  announce([next]);
}

/**
 * Deletes a song from MURMUR: out of «Guardadas», every playlist and album and the phone's downloads.
 * The record stays marked, so listening history keeps its name and a sync does not bring it back.
 */
export async function deleteSong(id: string) {
  const stored = await db.tracks.get(id);
  if (!stored) return;
  const lists = await db.playlists.toArray();
  const overrides = await db.playlist_overrides.where("trackId").equals(id).toArray();
  const holders = new Set([...lists.filter((p) => p.trackIds.includes(id)).map((p) => p.id), ...overrides.map((o) => o.spotify_playlist_id)]);
  for (const playlistId of holders) await removeSongs(playlistId, [id]);
  const latest = (await db.tracks.get(id)) ?? stored;
  if (latest.offlinePath && isNative) await Audio.deleteOfflineAudio({ path: latest.offlinePath }).catch(() => {});
  await db.tracks.put({ ...latest, saved: false, unliked: true, deleted: true, offlinePath: undefined });
}
