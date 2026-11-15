import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
import {sanitizePngForPrivatePublicationCandidate as sanitize} from
  '../../packages/storage-adapters/src/safe-png-publication.ts';

const sig=Buffer.from([137,80,78,71,13,10,26,10]);
function crc(b:Uint8Array):number {
  let c=0xffffffff;
  for(const byte of b){
    c^=byte;
    for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
  }
  return(c^0xffffffff)>>>0;
}
function chunk(type:string,data:Uint8Array):Buffer {
  const out=Buffer.alloc(data.length+12);
  out.writeUInt32BE(data.length,0);out.write(type,4,'ascii');
  out.set(data,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);
  return out;
}
const row=Buffer.from([0,10,20,30,255]);
function png(options:{
  width?:number;interlace?:number;color?:number;filter?:number;
  metadata?:boolean;split?:boolean;separated?:boolean;extra?:Buffer[];
}={}):Buffer {
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(options.width??1,0);ihdr.writeUInt32BE(1,4);
  ihdr[8]=8;ihdr[9]=options.color??6;ihdr[12]=options.interlace??0;
  const raw=Buffer.from(row);raw[0]=options.filter??0;
  const compressed=deflateSync(raw);
  const middle=options.metadata?[chunk('tEXt',Buffer.from('Author\0private identity'))]:[];
  const idat=options.split?[
    chunk('IDAT',compressed.subarray(0,3)),
    ...(options.separated?[chunk('tEXt',Buffer.from('X\0Y'))]:[]),
    chunk('IDAT',compressed.subarray(3))
  ]:[chunk('IDAT',compressed)];
  return Buffer.concat([sig,chunk('IHDR',ihdr),...middle,
    ...(options.extra??[]),...idat,chunk('IEND',new Uint8Array())]);
}
test('safe PNG candidate is deterministic and strips private metadata',()=>{
 const original=png({metadata:true,split:true});
 const a=sanitize(original),b=sanitize(original);
 assert.equal(a.width,1);assert.equal(a.height,1);
 assert.equal(a.mimeType,'image/png');assert.equal(a.sanitized,true);
 assert.equal(a.publicServingEnabled,false);
 assert.deepEqual(a.bytes,b.bytes);
 assert.equal(a.sha256,createHash('sha256').update(a.bytes).digest('hex'));
 assert.equal(Buffer.from(a.bytes).includes(Buffer.from('private identity')),false);
 assert.equal(Buffer.from(a.bytes).includes(Buffer.from('tEXt')),false);
 // Re-inflated rows must retain original actual pixels including alpha.
 const data=Buffer.from(a.bytes);
 const start=8+25; // PNG signature and IHDR chunk
 const size=data.readUInt32BE(start);
 assert.deepEqual(inflateSync(data.subarray(start+8,start+8+size)),row);
});
test('malformed CRC, unsafe signature, invalid filter and trailing data fail closed',()=>{
 const badCrc=png();badCrc[29]^=1;
 for(const candidate of [
   Buffer.from('not-png'),badCrc,png({filter:5}),
   Buffer.concat([png(),Buffer.from('trailing bytes')]),
   png({width:4097}),png({interlace:1}),png({color:3}),
   png({split:true,separated:true}),
   png({extra:[chunk('tRNS',Buffer.from([0]))]})
 ])assert.throws(()=>sanitize(candidate),/PNG_PUBLICATION_REJECTED/);
});
test('a dangerous decompression size and borrowed buffers are rejected',()=>{
 const forged=png({width:4096});
 assert.throws(()=>sanitize(forged),/PNG_PUBLICATION_REJECTED/);
 const source=png({metadata:true});
 const view=new Uint8Array(source.buffer,source.byteOffset,source.byteLength);
 const output=sanitize(view);
 assert.deepEqual(output.bytes,sanitize(source).bytes);
});
