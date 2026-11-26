import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { saveCollection } from "./CollectionImport";
import { db, playlistTracks } from "./db";
import {
  addSongs, applyAllAlbumCovers, createCollection, deleteCollection, deleteSong, deletedPlaylists, editCollection, editSong,
  likeSong, mergeSyncedPlaylist, mergeSyncedTrack, removeSongs, setCover, unlikeCollection, unlikeSong,
} from "./libraryEdit";
import type { Playlist, QueueItem } from "./types";

const song = (n: number, extra: Partial<QueueItem> = {}): QueueItem => ({
  id: "sp:" + n, source: "spotify", title: "Canción " + n, artist: "Artista", album: "Disco", duration: 200, tags: [],
  artworkUrl: `https://img/${n}.jpg`, ...extra,
});
const album = (): { playlist: Playlist; items: QueueItem[] } => ({
  playlist: { id: "sp:album:x", title: "Disco", kind: "album", source: "spotify", artist: "Artista", artworkUrl: "https://img/album.jpg", trackIds: ["sp:1", "sp:2", "sp:3"] },
  items: [song(1), song(2), song(3)],
});
const get = async (id: string) => (await db.tracks.get(id))!;
const ids = async (playlistId: string) => (await playlistTracks((await db.playlists.get(playlistId))!)).map((t) => t.id);

beforeEach(async () => { await db.transaction("rw", db.tables, async () => { for (const t of db.tables) await t.clear(); }); });

describe("saving an album is not liking its songs", () => {
  it("keeps its songs out of Guardadas, except the ones already there", async () => {
    await db.tracks.put(song(2, { saved: true }));
    await saveCollection(album());
    expect((await get("sp:1")).saved).toBe(false);
    expect((await get("sp:2")).saved).toBe(true);
    expect(await ids("sp:album:x")).toEqual(["sp:1", "sp:2", "sp:3"]);
  });
  it("one liked song of the album is the only one in Guardadas, also after saving it again", async () => {
    await saveCollection(album());
    await likeSong(await get("sp:3"));
    await saveCollection(album());
    expect((await db.tracks.toArray()).filter((t) => t.saved).map((t) => t.id)).toEqual(["sp:3"]);
  });
  it("saving a playlist still adds its songs", async () => {
    await saveCollection({ playlist: { id: "p", title: "P", source: "spotify", trackIds: ["sp:1"] }, items: [song(1)] });
    expect((await get("sp:1")).saved).toBe(true);
  });
  it("takes an old album's songs out of Guardadas in one step", async () => {
    await saveCollection(album());
    for (const n of [1, 2]) await likeSong(await get("sp:" + n));
    expect(await unlikeCollection("sp:album:x")).toBe(2);
    expect((await db.tracks.toArray()).some((t) => t.saved)).toBe(false);
  });
});

describe("an album's cover is the cover of its songs", () => {
  it("applies the automatic cover over each song's own thumbnail", async () => {
    await saveCollection(album());
    expect((await db.tracks.toArray()).map((t) => t.artworkUrl)).toEqual(Array(3).fill("https://img/album.jpg"));
  });
  it("applies an uploaded cover to every song, and restoring it goes back to the album's", async () => {
    await saveCollection(album());
    await setCover("playlist", "sp:album:x", { customArtwork: "data:image/jpeg;base64,AAAA" });
    expect((await db.tracks.toArray()).every((t) => t.customArtwork === "data:image/jpeg;base64,AAAA")).toBe(true);
    await setCover("playlist", "sp:album:x", { customArtwork: undefined });
    expect((await db.tracks.toArray()).every((t) => !t.customArtwork && t.artworkUrl === "https://img/album.jpg")).toBe(true);
  });
  it("takes the first song's cover for an album without one", async () => {
    await db.tracks.bulkPut([song(1), song(2)]);
    await db.playlists.put({ id: "local:a", title: "Mío", kind: "album", source: "hybrid", trackIds: ["sp:1", "sp:2"] });
    await applyAllAlbumCovers();
    expect((await get("sp:2")).artworkUrl).toBe("https://img/1.jpg");
  });
  it("gives a song its own cover back when it leaves the album or the album is deleted", async () => {
    await saveCollection(album());
    await removeSongs("sp:album:x", ["sp:1"]);
    expect((await get("sp:1")).artworkUrl).toBe("https://img/1.jpg");
    await deleteCollection("sp:album:x");
    expect((await get("sp:2")).artworkUrl).toBe("https://img/2.jpg");
    expect((await get("sp:2")).coverAlbum).toBeUndefined();
  });
  it("a song added to an album takes its cover", async () => {
    await saveCollection(album());
    await addSongs("sp:album:x", [song(9)]);
    expect((await get("sp:9")).artworkUrl).toBe("https://img/album.jpg");
    expect((await get("sp:9")).saved).toBe(false);
    expect(await ids("sp:album:x")).toContain("sp:9");
  });
  it("keeps the album cover when the provider syncs the song again", async () => {
    await saveCollection(album());
    const merged = mergeSyncedTrack(await get("sp:1"), song(1, { saved: true }));
    expect(merged.artworkUrl).toBe("https://img/album.jpg");
  });
});

describe("editing the library survives the sync", () => {
  it("creates, renames and deletes a playlist; deleting keeps likes and it does not come back", async () => {
    await db.tracks.put(song(1, { saved: true }));
    const p = await createCollection("playlist", { title: "  Mi   mix " }, [await get("sp:1")]);
    expect(p.title).toBe("Mi mix");
    await editCollection(p.id, { title: "Otro" });
    expect((await db.playlists.get(p.id))?.title).toBe("Otro");
    await deleteCollection(p.id);
    expect(await db.playlists.get(p.id)).toBeUndefined();
    expect((await get("sp:1")).saved).toBe(true);
    expect(mergeSyncedPlaylist(undefined, { ...p }, await deletedPlaylists())).toBeUndefined();
  });
  it("creates an album with artist and year", async () => {
    const a = await createCollection("album", { title: "Nuevo", artist: "Yo", year: "2026" });
    expect(a).toMatchObject({ kind: "album", artist: "Yo", year: "2026", trackIds: [] });
    await expect(createCollection("album", { title: "   " })).rejects.toThrow();
  });
  it("a removed song stays removed after a sync, a rename stays, and undo brings it back", async () => {
    const incoming: Playlist = { id: "p", title: "De Spotify", source: "spotify", trackIds: ["sp:1", "sp:2"] };
    await db.tracks.bulkPut([song(1), song(2)]);
    await db.playlists.put(incoming);
    const undo = await removeSongs("p", ["sp:1"]);
    await editCollection("p", { title: "La mía" });
    const merged = mergeSyncedPlaylist(await db.playlists.get("p"), incoming)!;
    expect(merged.trackIds).toEqual(["sp:2"]);
    expect(merged.title).toBe("La mía");
    await undo();
    expect(await ids("p")).toEqual(["sp:1", "sp:2"]);
  });
  it("songs added to a synced playlist live beside it and can be removed", async () => {
    await db.tracks.put(song(1));
    await db.playlists.put({ id: "p", title: "P", source: "spotify", trackIds: ["sp:1"] });
    await addSongs("p", [song(5)]);
    expect(await ids("p")).toEqual(["sp:1", "sp:5"]);
    await removeSongs("p", ["sp:5"]);
    expect(await ids("p")).toEqual(["sp:1"]);
    await addSongs("p", [song(5)]);
    expect(await ids("p")).toEqual(["sp:1", "sp:5"]);
  });
  it("an unliked song is not liked again by a sync and leaves Spotify's liked list", async () => {
    await db.tracks.put(song(1, { saved: true, tags: ["liked"] }));
    await db.playlists.put({ id: "sp:liked", title: "Tus Me Gusta", source: "spotify", trackIds: ["sp:1"] });
    await unlikeSong("sp:1");
    expect(await ids("sp:liked")).toEqual([]);
    expect(mergeSyncedTrack(await get("sp:1"), song(1, { saved: true })).saved).toBe(false);
  });
  it("corrected names stay after a sync", async () => {
    await db.tracks.put(song(1));
    await editSong("sp:1", { title: "Bien escrito", artist: "Artista Real" });
    expect(mergeSyncedTrack(await get("sp:1"), song(1)).title).toBe("Bien escrito");
  });
  it("a deleted song leaves every list and a sync does not bring it back", async () => {
    await saveCollection(album());
    await db.playlists.put({ id: "p", title: "P", source: "hybrid", trackIds: ["sp:1", "sp:2"] });
    await likeSong(await get("sp:1"));
    await deleteSong("sp:1");
    expect(await ids("p")).toEqual(["sp:2"]);
    expect(await ids("sp:album:x")).toEqual(["sp:2", "sp:3"]);
    expect(mergeSyncedTrack(await get("sp:1"), song(1, { saved: true }))).toMatchObject({ saved: false, deleted: true });
  });
});
