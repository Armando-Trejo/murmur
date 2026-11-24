import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files=['src/assets/murmur-mark.png', ...['murmur_mark','murmur_launcher','murmur_lockup'].map(n=>'android/app/src/main/res/drawable-nodpi/'+n+'.png')];
const keyword='impeccable:prompt';
const origin='Source: user-supplied Gemini_Generated_Image_shkmzrshkmzrshkm.jpg, 22 November 2026. Existing artwork cropped and downsampled for application resources, without redrawing.';
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
for(const file of files){
 const full=path.join(root,file), png=fs.readFileSync(full), chunks=[png.subarray(0,8)];
 if(png.readUInt32BE(0)!==0x89504e47)throw Error('Expected PNG');
 for(let offset=8;offset+12<=png.length;){
  const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),end=offset+12+length;
  if(type==='IEND'){
   const content=Buffer.from(keyword+'\0'+origin,'latin1'),chunk=Buffer.alloc(content.length+12);
   chunk.writeUInt32BE(content.length,0);chunk.write('tEXt',4,'ascii');content.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,8+content.length)),8+content.length);chunks.push(chunk);
  }
  if(!(type==='tEXt'&&png.toString('latin1',offset+8,offset+8+length).startsWith(keyword+'\0')))chunks.push(png.subarray(offset,end));
  offset=end;
 }
 fs.writeFileSync(full,Buffer.concat(chunks));
}
