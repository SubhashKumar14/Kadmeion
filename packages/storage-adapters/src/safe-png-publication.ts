/**
 * Server-only B08 PNG publication sanitizer. Does NOT publish any object.
 * Caller must authenticate owner access, verify an immutable asset pin and
 * independently authorize the intended frozen release before promotion.
 *
 * Accept a strict PNG subset: non-interlaced 8-bit RGB or RGBA, no palettes,
 * animations or transparency sidecars. Verify every chunk CRC and inflate the
 * complete pixel stream within bounded memory, then recompress only the
 * scanlines into a fresh PNG. All ancillary chunks (including EXIF/text/ICC)
 * are discarded. Other formats fail closed; they need independent converters.
 */
import {createHash} from 'node:crypto';
import {inflateSync,deflateSync} from 'node:zlib';

const SIGNATURE=Uint8Array.from([137,80,78,71,13,10,26,10]);
const MAX_INPUT=5*1024*1024;
const MAX_PIXELS=8*1024*1024;
const MAX_DIMENSION=4096;
const MAX_CHUNKS=64;
const MAX_OUTPUT=5*1024*1024;
const table=Uint32Array.from({length:256},(_,n)=>{
  let c=n;
  for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
  return c>>>0;
});
function crc32(bytes:Uint8Array):number {
  let c=0xffffffff;
  for(const b of bytes)c=table[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function fail():never {
  throw new Error('PNG_PUBLICATION_REJECTED');
}
export interface SanitizedPublicationPng {
  bytes:Uint8Array;
  sha256:string;
  mimeType:'image/png';
  width:number;
  height:number;
  sanitized:true;
  publicServingEnabled:false;
}
function chunk(type:'IHDR'|'IDAT'|'IEND',bytes:Uint8Array):Buffer {
  const out=Buffer.allocUnsafe(bytes.length+12);
  out.writeUInt32BE(bytes.length,0);
  out.write(type,4,'ascii');
  out.set(bytes,8);
  out.writeUInt32BE(crc32(out.subarray(4,out.length-4)),out.length-4);
  return out;
}
export function sanitizePngForPrivatePublicationCandidate(input:Uint8Array):
  SanitizedPublicationPng {
  if(!(input instanceof Uint8Array)||input.byteLength<57||
     input.byteLength>MAX_INPUT||!SIGNATURE.every((b,i)=>input[i]===b))fail();
  const bytes=Buffer.from(input);
  let cursor=8,width=0,height=0,channels=0;
  let phase:'START'|'BEFORE_IDAT'|'IN_IDAT'|'AFTER_IDAT'|'DONE'='START';
  const idats:Buffer[]=[];
  let compressed=0;
  for(let count=0;cursor<bytes.length;count++){
    if(count>=MAX_CHUNKS||cursor+12>bytes.length)fail();
    const len=bytes.readUInt32BE(cursor);
    if(len>MAX_INPUT||len>bytes.length-cursor-12)fail();
    const type=bytes.toString('ascii',cursor+4,cursor+8);
    if(!/^[A-Za-z]{4}$/.test(type)||type[2]!==type[2].toUpperCase())fail();
    const begin=cursor+8,after=begin+len;
    if(crc32(bytes.subarray(cursor+4,after))!==bytes.readUInt32BE(after))fail();
    cursor=after+4;
    if(type==='IHDR'){
      if(phase!=='START'||len!==13)fail();
      width=bytes.readUInt32BE(begin);height=bytes.readUInt32BE(begin+4);
      const depth=bytes[begin+8],color=bytes[begin+9];
      if(depth!==8||(color!==2&&color!==6)||
         bytes[begin+10]!==0||bytes[begin+11]!==0||bytes[begin+12]!==0||
         width<1||height<1||width>MAX_DIMENSION||height>MAX_DIMENSION||
         width*height>MAX_PIXELS)fail();
      channels=color===6?4:3;
      phase='BEFORE_IDAT';
    }else if(type==='IDAT'){
      if(phase!=='BEFORE_IDAT'&&phase!=='IN_IDAT')fail();
      compressed+=len;
      if(compressed>MAX_INPUT)fail();
      idats.push(bytes.subarray(begin,after));
      phase='IN_IDAT';
    }else if(type==='IEND'){
      if((phase!=='IN_IDAT'&&phase!=='AFTER_IDAT')||len!==0||
         idats.length===0||cursor!==bytes.length)fail();
      phase='DONE';
      break;
    }else{
      // Reject animation/sidecar transparency and all unknown critical chunks.
      if(phase==='START'||type[0]===type[0].toUpperCase()||
         ['acTL','fcTL','fdAT','tRNS'].includes(type))fail();
      if(phase==='IN_IDAT')phase='AFTER_IDAT';
    }
  }
  if(phase!=='DONE')fail();
  const stride=1+width*channels;
  const expected=stride*height;
  let raw:Buffer;
  try{
    raw=inflateSync(Buffer.concat(idats,compressed),{maxOutputLength:expected+1});
  }catch{fail();}
  if(raw.length!==expected)fail();
  for(let i=0;i<expected;i+=stride)if(raw[i]>4)fail();
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
  ihdr[8]=8;ihdr[9]=channels===4?6:2;
  const deflated=deflateSync(raw,{level:6});
  const output=Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR',ihdr),chunk('IDAT',deflated),chunk('IEND',new Uint8Array())
  ]);
  if(output.byteLength>MAX_OUTPUT)fail();
  return {
    bytes:Uint8Array.from(output),
    sha256:createHash('sha256').update(output).digest('hex'),
    mimeType:'image/png',width,height,sanitized:true,publicServingEnabled:false
  };
}
