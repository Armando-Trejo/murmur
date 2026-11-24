import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, addToPlaylist, playlistTracks, exportBackup, importBackup } from './db';
import type { QueueItem, Playlist } from './types';
const sp: QueueItem = { id: 'sp:one', source: 'spotify', title: 'Studio', artist: 'Artist', duration: 200, tags: [] };
const yt: QueueItem = { id: 'yt:two', videoId: 'abcdefghijk', source: 'youtube', title: 'Live', artist: 'Artist', duration: 202, tags: ['live'] };
beforeEach(async () => { await db.transaction('rw', db.tables, async () => { for (const t of db.tables) await t.clear(); }); });
describe('non-destructive local playlist overlays and backups', () => {
 it('adds YouTube to imported Spotify playlists without changing the base track ids', async () => { const playlist: Playlist = { id: 'imported', title: 'Imported', source: 'spotify', trackIds: [sp.id] }; await db.tracks.put(sp); await db.playlists.put(playlist); await addToPlaylist(playlist.id, yt, 0); expect((await db.playlists.get(playlist.id))?.trackIds).toEqual([sp.id]); expect((await playlistTracks(playlist)).map(t => t.id)).toEqual([yt.id,sp.id]); });
 it('deduplicates overlay inserts', async () => { await db.playlists.put({ id: 'p', title: 'p', source:'spotify',trackIds:[] }); await addToPlaylist('p',yt); await addToPlaylist('p',yt); expect(await db.playlist_overrides.count()).toBe(1); });
 it('persists local playlists and merges backup atomically', async () => { await db.playlists.put({ id:'p',title:'Local',source:'hybrid',trackIds:[] }); await addToPlaylist('p',yt); const backup = await exportBackup(); await db.tracks.put(sp); await importBackup(backup); expect(await db.tracks.count()).toBe(2); expect((await db.playlists.get('p'))?.trackIds).toEqual([yt.id]); expect(backup).not.toContain('sp_dc'); });
 it('rejects invalid backup before changing data', async () => { await db.tracks.put(sp); await expect(importBackup('{"format":"hybrid-sound","version":1,"tables":{"tracks":[{"id":"bad"}]}}')).rejects.toThrow(); expect(await db.tracks.count()).toBe(1); });
 it('rolls back track writes when the target playlist does not exist', async () => { await expect(addToPlaylist('missing',yt)).rejects.toThrow(); expect(await db.tracks.count()).toBe(0); });
});
