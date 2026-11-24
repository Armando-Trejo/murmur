import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(() => ({ verify:vi.fn(async () => ({spotify:true,youtube:false,oauth:true})), request:vi.fn<(o:{path:string;method?:string;body?:string})=>Promise<{data:any}>>() }));
vi.mock('../native',() => ({Auth:{verifySpotify:mocks.verify,spotifyRequest:mocks.request},Audio:{},isNative:false}));
import { fetchSpotifyPages, syncSpotifyLibrary, unwrapSpotifyTrack } from './SpotifyLibrary';
import { db } from './db';
const track={id:'one',type:'track',name:'Real imported title',uri:'spotify:track:one',duration_ms:200000,artists:[{name:'Artist'}],album:{images:[]}};
beforeEach(async () => { vi.clearAllMocks();mocks.verify.mockResolvedValue({spotify:true,youtube:false,oauth:true});await db.transaction('rw',db.tables,async()=>{for(const table of db.tables)await table.clear();}); });
describe('Spotify 2026 library integration', () => {
  it('supports new item fields and the previous track wrapper',()=>{expect(unwrapSpotifyTrack({item:track})?.title).toBe(track.name);expect(unwrapSpotifyTrack({track})?.title).toBe(track.name);expect(unwrapSpotifyTrack({item:null})).toBeUndefined();expect(unwrapSpotifyTrack({item:{...track,type:'episode'}})).toBeUndefined();});
  it('imports through /items and preserves local playlist overlays',async()=>{
    mocks.request.mockImplementation(async({path})=>({data:path.startsWith('/me/tracks')?{items:[{track}],next:null}:path.startsWith('/me/playlists')?{items:[{id:'p1',name:'Mine'}],next:null}:path.startsWith('/playlists/p1/items')?{items:[{item:track}],next:null}:{items:[]}}));
    await db.playlist_overrides.add({spotify_playlist_id:'p1',trackId:'yt:local',videoId:'abcdefghijk',position:0});
    const summary=await syncSpotifyLibrary();expect(summary.tracks).toBe(1);expect(summary.playlists).toBe(1);expect(await db.playlist_overrides.count()).toBe(1);expect(mocks.request.mock.calls.some(([r])=>r.path.includes('/tracks')&&r.path.startsWith('/playlists/'))).toBe(false);expect((await db.playlists.get('p1'))?.trackIds).toEqual(['sp:one']);
  });
  it('retains a denied playlist and continues other imports',async()=>{
    await db.playlists.put({id:'denied',title:'Followed',source:'spotify',trackIds:['sp:previous']});
    mocks.request.mockImplementation(async({path})=>{if(path.startsWith('/playlists/denied/items'))throw Object.assign(new Error('Not permitted'),{code:'SPOTIFY_PERMISSION_DENIED'});return {data:path.startsWith('/me/playlists')?{items:[{id:'denied',name:'Followed'},{id:'mine',name:'Mine'}],next:null}:{items:[],next:null}};});
    const summary=await syncSpotifyLibrary();expect(summary.unavailable).toEqual(['Followed']);expect(summary.playlists).toBe(1);expect((await db.playlists.get('denied'))?.trackIds).toEqual(['sp:previous']);
  });
  it('does not write library data before checking real access',async()=>{mocks.verify.mockResolvedValue({spotify:false,youtube:false,oauth:false});await expect(syncSpotifyLibrary()).rejects.toThrow('Autoriza');expect(mocks.request).not.toHaveBeenCalled();expect(await db.tracks.count()).toBe(0);});
  it('follows offsets and rejects malformed pages',async()=>{mocks.request.mockResolvedValueOnce({data:{items:[track],next:'next'}}).mockResolvedValueOnce({data:{items:[track],next:null}});expect(await fetchSpotifyPages('/me/tracks')).toHaveLength(2);expect(mocks.request.mock.calls[1][0].path).toContain('offset=1');mocks.request.mockResolvedValueOnce({data:{unexpected:true}});await expect(fetchSpotifyPages('/me/tracks')).rejects.toThrow('inválida');});
});
