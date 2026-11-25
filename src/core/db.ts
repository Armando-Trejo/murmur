import Dexie, { type Table } from 'dexie';
import type { QueueItem, Playlist, Override, HistoryEntry } from './types';
export class HybridDatabase extends Dexie {
  tracks!: Table<QueueItem, string>; playlists!: Table<Playlist, string>; playlist_overrides!: Table<Override, number>; history!: Table<HistoryEntry, number>; affinity!: Table<{ tag: string; weight: number }, string>; settings!: Table<{ key: string; value: unknown }, string>;
  constructor(name = 'HybridSound') { super(name); this.version(1).stores({ tracks: 'id,source,artist,*tags', playlists: 'id,source', playlist_overrides: '++id,spotify_playlist_id,trackId', history: '++id,trackId,at', affinity: 'tag', settings: 'key' }); }
}
export const db = new HybridDatabase();
export async function saveTrack(track: QueueItem) { await db.tracks.put({ ...track, saved: true }); }
export async function addToPlaylist(playlistId: string, track: QueueItem, position?: number) {
  await db.transaction('rw', [db.tracks, db.playlists, db.playlist_overrides], async () => {
    await db.tracks.put(track); const playlist = await db.playlists.get(playlistId); if (!playlist) throw new Error('La playlist ya no existe.');
    if (playlist.source !== 'hybrid') { if (!(await db.playlist_overrides.where('spotify_playlist_id').equals(playlistId).and(o => o.trackId === track.id).count())) await db.playlist_overrides.add({ spotify_playlist_id: playlistId, trackId: track.id, videoId: track.videoId || '', position: position ?? playlist.trackIds.length }); }
    else if (!playlist.trackIds.includes(track.id)) { const ids = [...playlist.trackIds]; ids.splice(position ?? ids.length, 0, track.id); await db.playlists.update(playlistId, { trackIds: ids }); }
  });
}
export async function playlistTracks(playlist: Playlist) { const ids = [...playlist.trackIds]; const overlays = await db.playlist_overrides.where('spotify_playlist_id').equals(playlist.id).sortBy('position'); overlays.forEach(o => ids.splice(Math.max(0, Math.min(o.position, ids.length)), 0, o.trackId)); return (await db.tracks.bulkGet(ids)).filter((x): x is QueueItem => !!x); }
const tableNames = ['tracks', 'playlists', 'playlist_overrides', 'history', 'affinity', 'settings'] as const;
/** App preferences kept in localStorage (accent, glows, Spotify mode and Client ID, session, welcome…). Diagnostics stay out. */
function preferences() {
  const prefs: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('murmur.') || key === 'murmur.jsErrors') continue;
      const value = localStorage.getItem(key);
      if (value !== null && value.length < 200_000) prefs[key] = value;
    }
  } catch { /* No storage (tests, private mode): tables only. */ }
  return prefs;
}
/** Version 2 adds the app's preferences, so a restore brings back the whole setup, not only the library. */
export async function exportBackup(pretty = true) { const tables: Record<string, unknown[]> = {}; for (const name of tableNames) tables[name] = await db.table(name).toArray(); return JSON.stringify({ format: 'hybrid-sound', version: 2, exportedAt: new Date().toISOString(), tables, prefs: preferences() }, null, pretty ? 2 : undefined); }
export async function importBackup(text: string) {
  if (text.length > 50_000_000) throw new Error('El respaldo supera los 50 MB.');
  const data = JSON.parse(text);
  if (data.format !== 'hybrid-sound' || (data.version !== 1 && data.version !== 2) || !data.tables) throw new Error('Formato de respaldo incompatible.');
  if (data.prefs !== undefined && (typeof data.prefs !== 'object' || data.prefs === null || Array.isArray(data.prefs))) throw new Error('Preferencias inválidas.');
  const validString = (s: unknown) => typeof s === 'string' && s.length < 20000;
  for (const name of tableNames) { const rows = data.tables[name]; if (!Array.isArray(rows) || rows.length > 100000) throw new Error('Tabla inválida: ' + name); for (const r of rows) { if (!r || typeof r !== 'object') throw new Error('Registro inválido.'); if (name === 'tracks' && (!validString(r.id) || !validString(r.title) || !validString(r.artist) || !['spotify', 'youtube'].includes(r.source) || !Number.isFinite(r.duration) || !Array.isArray(r.tags))) throw new Error('Canción inválida.'); if (name === 'playlists' && (!validString(r.id) || !validString(r.title) || !Array.isArray(r.trackIds))) throw new Error('Playlist inválida.'); if (name === 'settings' && !validString(r.key)) throw new Error('Ajuste inválido.'); if (name === 'affinity' && (!validString(r.tag) || !Number.isFinite(r.weight))) throw new Error('Afinidad inválida.'); if (name === 'playlist_overrides' && (!validString(r.spotify_playlist_id) || !validString(r.trackId) || !Number.isFinite(r.position))) throw new Error('Overlay inválido.'); if (name === 'history' && (!validString(r.trackId) || !Number.isFinite(r.at) || !Number.isFinite(r.seconds))) throw new Error('Historial inválido.'); } }
  // Merge in one transaction. Credentials stay in Android's encrypted storage, outside backups.
  await db.transaction('rw', db.tables, async () => { for (const name of tableNames) await db.table(name).bulkPut(data.tables[name]); });
  // Preferences only for MURMUR's own keys, as plain strings.
  let prefs = 0;
  for (const [key, value] of Object.entries((data.prefs ?? {}) as Record<string, unknown>)) {
    if (!key.startsWith('murmur.') || key === 'murmur.jsErrors' || typeof value !== 'string' || value.length >= 200_000) continue;
    try { localStorage.setItem(key, value); prefs++; } catch { /* Storage full: the library is what matters. */ }
  }
  return { tracks: data.tables.tracks.length as number, playlists: data.tables.playlists.length as number, prefs };
}
