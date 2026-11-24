import "fake-indexeddb/auto";
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({spotify:vi.fn(),youtube:vi.fn()}));
vi.mock("../native",()=>({isNative:true,Auth:{spotifyRequest:mocks.spotify,youtubeCollection:mocks.youtube}}));
import {parseCollectionLink,importCollectionLink,readCollectionLink,saveCollection} from "./CollectionImport";
import {db} from "./db";
beforeEach(async()=>{vi.clearAllMocks();await db.tracks.clear();await db.playlists.clear()});
it.each([['https://open.spotify.com/intl-es/album/1234567890123456789012?si=x','album'],['spotify:playlist:1234567890123456789012','playlist'],['https://youtu.be/abcdefghijk?list=RDabcdefghijk','mix'],['https://music.youtube.com/browse/MPREb_example','album']])('recognizes collection %s',(url,kind)=>expect(parseCollectionLink(url).kind).toBe(kind));
it.each(['https://evil.test/playlist?list=PLx','https://youtube.com.evil.test/?list=PLx','file:///secret','https://open.spotify.com/track/1234567890123456789012'])('rejects unrelated URLs %s',url=>expect(()=>parseCollectionLink(url)).toThrow());
it('imports album metadata across all pages and preserves offline audio',async()=>{
 await db.tracks.put({id:'sp:one',source:'spotify',title:'Old',artist:'Artist',duration:200,tags:[],offlinePath:'/offline'});
 mocks.spotify.mockImplementation(async({path})=>({data:path.includes('/tracks')?{items:[{id:'one',uri:'spotify:track:one',name:'Song',type:'track',artists:[{name:'Artist'}],duration_ms:200000}],next:null}:{name:'Album',images:[{url:'https://image.test/cover'}]}}));
 const p=await importCollectionLink('https://open.spotify.com/album/1234567890123456789012');
 expect(p.kind).toBe('album');expect(p.trackIds).toEqual(['sp:one']);expect((await db.tracks.get('sp:one'))?.album).toBe('Album');expect((await db.tracks.get('sp:one'))?.offlinePath).toBe('/offline');
});
it('does not overwrite a collection on denied or empty results',async()=>{
 await db.playlists.put({id:'ytpl:VLPLexample',title:'Existing',source:'youtube',trackIds:['old']});mocks.youtube.mockResolvedValue({title:'Empty',tracks:[]});await expect(importCollectionLink('https://youtube.com/playlist?list=PLexample')).rejects.toThrow();expect((await db.playlists.get('ytpl:VLPLexample'))?.trackIds).toEqual(['old']);
});

it('opens a signed-in recommendation without saving it until requested',async()=>{
 const track={id:'yt:abcdefghijk',source:'youtube',title:'Elegida',artist:'Artista',duration:200,tags:[]};
 mocks.youtube.mockResolvedValue({title:'Mi mix',tracks:[track]});
 const collection=await readCollectionLink('https://music.youtube.com/playlist?list=RDexample',true);
 expect(mocks.youtube).toHaveBeenCalledWith({id:'RDexample',personalized:true});
 expect(await db.playlists.count()).toBe(0);
 expect(await db.tracks.count()).toBe(0);
 await saveCollection(collection);
 expect(await db.playlists.count()).toBe(1);
 expect((await db.tracks.get(track.id))?.saved).toBe(true);
});
