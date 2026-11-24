import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const mocks=vi.hoisted(()=>({library:vi.fn(),playlist:vi.fn()}));
vi.mock('../native',()=>({Auth:{youtubeLibrary:mocks.library,youtubePlaylist:mocks.playlist}}));
import { importYouTubeLibrary } from './YouTubeLibrary';
import { db } from './db';
beforeEach(async()=>{vi.clearAllMocks();await db.transaction('rw',db.tables,async()=>{for(const t of db.tables)await t.clear();});});
describe('truthful YouTube library import',()=>{
  it('writes songs before reporting playlist success',async()=>{mocks.library.mockResolvedValue({playlists:[{id:'ytpl:VLtest',title:'Live'}]});mocks.playlist.mockResolvedValue({tracks:[{id:'yt:one',videoId:'abcdefghijk',source:'youtube',title:'Caifanes - Afuera live',artist:'Fan account',duration:200,tags:[]}]});const result=await importYouTubeLibrary();expect(result.imported).toBe(1);expect(result.tracks).toBe(1);expect((await db.playlists.get('ytpl:VLtest'))?.trackIds).toEqual(['yt:one']);expect((await db.tracks.get('yt:one'))?.artist).toBe('Caifanes');});
  it('does not create empty playlists when all song imports fail',async()=>{mocks.library.mockResolvedValue({playlists:[{id:'ytpl:VLtest',title:'Private'}]});mocks.playlist.mockRejectedValue(new Error('403'));await expect(importYouTubeLibrary()).rejects.toThrow('No se crearon listas vacías');expect(await db.playlists.count()).toBe(0);});
  it('retains old tracks and continues successful playlists',async()=>{await db.playlists.put({id:'ytpl:VLdenied',title:'Private',source:'youtube',trackIds:['yt:old']});mocks.library.mockResolvedValue({playlists:[{id:'ytpl:VLdenied',title:'Private'},{id:'ytpl:VLempty',title:'Actually empty'}]});mocks.playlist.mockImplementation(async({id})=>{if(id==='ytpl:VLdenied')throw Error('403');return {tracks:[]};});const result=await importYouTubeLibrary();expect(result.imported).toBe(1);expect(result.unavailable).toEqual(['Private']);expect((await db.playlists.get('ytpl:VLdenied'))?.trackIds).toEqual(['yt:old']);});
});
