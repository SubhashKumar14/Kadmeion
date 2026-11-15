import { ContractError } from '../../contracts/src/project.ts';
import { validateSnapshot, type PortfolioSnapshot } from '../../editor-core/src/index.ts';

const LIMIT=2*1024*1024;
const MAX_ENTRIES=101;
const MANIFEST='kadmeion.export.json';
const decoder=new TextDecoder('utf-8',{fatal:true});
const encoder=new TextEncoder();
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){
  let c=n;
  for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1;
  crcTable[n]=c>>>0;
}
function crc32(data:Uint8Array):number {
  let crc=0xffffffff;
  for(const byte of data)crc=crcTable[(crc^byte)&255]!^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function check(condition:unknown,message:string):asserts condition {
  if(!condition)throw new ContractError('VALIDATION',message);
}
function u16(view:DataView,at:number,value:number):void{view.setUint16(at,value,true);}
function u32(view:DataView,at:number,value:number):void{view.setUint32(at,value,true);}

interface Entry {name:string;nameBytes:Uint8Array;bytes:Uint8Array;crc:number;offset:number}
export interface StoredZipPart { name:string; bytes:Uint8Array }
export interface StoredZipLimits { maxEntries:number; maxBytes:number; maxEntryBytes:number }
/** Byte-stable ZIP-STORE writer; caller decides what data is safe to include. */
export function writeStoredZip(parts:readonly StoredZipPart[],limits:StoredZipLimits):Uint8Array {
  check(Array.isArray(parts)&&parts.length>0&&Number.isSafeInteger(limits.maxEntries)&&
    parts.length<=limits.maxEntries&&limits.maxEntries<=101 &&
    Number.isSafeInteger(limits.maxBytes)&&limits.maxBytes>22&&limits.maxBytes<=10*1024*1024 &&
    Number.isSafeInteger(limits.maxEntryBytes)&&limits.maxEntryBytes>0&&
    limits.maxEntryBytes<=limits.maxBytes,'Invalid ZIP resource limits.');
  const seen=new Set<string>();
  const entries:Entry[]=parts.map(part=>{
    const name=part?.name;
    check(typeof name==='string' && name.length<=160 &&
      /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(name) && !name.includes('..') &&
      !name.includes('//') && !name.endsWith('/') &&
      !name.split('/').includes('.') && !seen.has(name),
      'Unsafe or duplicate ZIP filename.');
    seen.add(name);
    check(part.bytes instanceof Uint8Array && part.bytes.byteLength<=limits.maxEntryBytes,
      'Oversized ZIP entry.');
    return {name,nameBytes:encoder.encode(name),bytes:part.bytes,crc:crc32(part.bytes),offset:0};
  });
  const localBytes=entries.reduce((n,e)=>n+30+e.nameBytes.length+e.bytes.length,0);
  const centralBytes=entries.reduce((n,e)=>n+46+e.nameBytes.length,0);
  const total=localBytes+centralBytes+22;
  check(total<=limits.maxBytes,'Portable ZIP exceeds size limit.');
  const out=new Uint8Array(total),view=new DataView(out.buffer);
  let pos=0;
  for(const e of entries){
    e.offset=pos;
    u32(view,pos,0x04034b50);u16(view,pos+4,20);u16(view,pos+6,0x800);
    u16(view,pos+8,0);u16(view,pos+10,0);u16(view,pos+12,0);
    u32(view,pos+14,e.crc);u32(view,pos+18,e.bytes.length);u32(view,pos+22,e.bytes.length);
    u16(view,pos+26,e.nameBytes.length);u16(view,pos+28,0);
    pos+=30;out.set(e.nameBytes,pos);pos+=e.nameBytes.length;
    out.set(e.bytes,pos);pos+=e.bytes.length;
  }
  const centralOffset=pos;
  for(const e of entries){
    u32(view,pos,0x02014b50);u16(view,pos+4,20);u16(view,pos+6,20);
    u16(view,pos+8,0x800);u16(view,pos+10,0);u16(view,pos+12,0);u16(view,pos+14,0);
    u32(view,pos+16,e.crc);u32(view,pos+20,e.bytes.length);u32(view,pos+24,e.bytes.length);
    u16(view,pos+28,e.nameBytes.length);u16(view,pos+30,0);u16(view,pos+32,0);
    u16(view,pos+34,0);u16(view,pos+36,0);u32(view,pos+38,0);u32(view,pos+42,e.offset);
    pos+=46;out.set(e.nameBytes,pos);pos+=e.nameBytes.length;
  }
  u32(view,pos,0x06054b50);u16(view,pos+4,0);u16(view,pos+6,0);
  u16(view,pos+8,entries.length);u16(view,pos+10,entries.length);
  u32(view,pos+12,pos-centralOffset);u32(view,pos+16,centralOffset);u16(view,pos+20,0);
  pos+=22;
  check(pos===total,'ZIP layout offset mismatch.');
  return out;
}
export function exportPortfolioSourceZip(snapshot:PortfolioSnapshot):Uint8Array {
  validateSnapshot(snapshot);
  const paths=Object.keys(snapshot.files).sort();
  const manifest=JSON.stringify({
    kind:'kadmeion-source-archive',formatVersion:1,
    files:paths,slots:snapshot.slots,stashes:snapshot.stashes
  });
  return writeStoredZip([
    {name:MANIFEST,bytes:encoder.encode(manifest)},
    ...paths.map(name=>({name,bytes:encoder.encode(snapshot.files[name])}))
  ],{maxEntries:MAX_ENTRIES,maxBytes:LIMIT,maxEntryBytes:256*1024});
}

export function importPortfolioSourceZip(input:Uint8Array):PortfolioSnapshot {
  check(input instanceof Uint8Array&&input.byteLength>=22&&input.byteLength<=LIMIT,
    'Archive is missing or exceeds size limits.');
  const data=new Uint8Array(input),view=new DataView(data.buffer);
  const end=data.byteLength-22;
  check(view.getUint32(end,true)===0x06054b50,'ZIP footer missing.');
  check(view.getUint16(end+20,true)===0 &&
    view.getUint16(end+4,true)===0&&view.getUint16(end+6,true)===0,
    'ZIP comments or split archives are unsupported.');
  const count=view.getUint16(end+10,true),centralSize=view.getUint32(end+12,true),
    centralOffset=view.getUint32(end+16,true);
  check(count>0&&count<=MAX_ENTRIES&&count===view.getUint16(end+8,true)&&
    centralOffset>=0&&centralOffset+centralSize===end,'Invalid central directory.');
  const entries=new Map<string,{bytes:Uint8Array;offset:number;crc:number}>();
  let pos=0;
  while(pos<centralOffset){
    check(pos+30<=centralOffset&&view.getUint32(pos,true)===0x04034b50,'Invalid local ZIP header.');
    const flags=view.getUint16(pos+6,true),method=view.getUint16(pos+8,true),
      crc=view.getUint32(pos+14,true),size=view.getUint32(pos+18,true),
      sizeUncompressed=view.getUint32(pos+22,true),
      nameSize=view.getUint16(pos+26,true),extraSize=view.getUint16(pos+28,true);
    check(flags===0x800&&method===0&&size===sizeUncompressed&&
      size<=256*1024&&nameSize>0,'Compressed, encrypted or oversized ZIP entry refused.');
    const offset=pos,begin=pos+30,endName=begin+nameSize,dataStart=endName+extraSize;
    check(dataStart+size<=centralOffset,'ZIP entry crosses archive boundary.');
    let name:string;
    try{name=decoder.decode(data.subarray(begin,endName));}
    catch{throw new ContractError('VALIDATION','Invalid ZIP filename encoding.');}
    // Accept only canonical, writer-compatible paths. Opaque ZIP names can
    // alias the same file differently across extractors and importers.
    check(!entries.has(name)&&name.length<=160&&
      /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(name)&&
      !name.includes('..')&&!name.includes('//')&&!name.endsWith('/')&&
      !name.split('/').includes('.'),
      'Duplicate or unsafe ZIP filename.');
    const bytes=data.slice(dataStart,dataStart+size);
    check(crc32(bytes)===crc,'ZIP integrity check failed.');
    entries.set(name,{bytes,offset,crc});
    pos=dataStart+size;
  }
  check(pos===centralOffset&&entries.size===count,'Local ZIP header count mismatch.');
  let cursor=centralOffset;
  const centralSeen=new Set<string>();
  for(let i=0;i<count;i++){
    check(cursor+46<=end&&view.getUint32(cursor,true)===0x02014b50,'Invalid central ZIP record.');
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),
      crc=view.getUint32(cursor+16,true),size=view.getUint32(cursor+20,true),
      nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),
      comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true);
    check(method===0&&flags===0x800&&cursor+46+nameLength+extra+comment<=end,
      'Unsupported central ZIP entry.');
    let name:string;
    try{name=decoder.decode(data.subarray(cursor+46,cursor+46+nameLength));}
    catch{throw new ContractError('VALIDATION','Invalid central filename.');}
    const actual=entries.get(name);
    check(actual&&!centralSeen.has(name)&&actual.crc===crc&&
      actual.bytes.length===size&&actual.offset===offset,
      'ZIP central and local entries disagree or repeat.');
    centralSeen.add(name);
    cursor+=46+nameLength+extra+comment;
  }
  check(cursor===end&&centralSeen.size===entries.size,
    'Central ZIP is incomplete or inconsistent.');
  const meta=entries.get(MANIFEST);
  check(meta,'Expected Kadmeion export manifest.');
  let manifest:unknown;
  try{manifest=JSON.parse(decoder.decode(meta.bytes));}
  catch{throw new ContractError('VALIDATION','Invalid archive manifest JSON.');}
  const record=manifest as {kind?:string;formatVersion?:number;files?:string[];
    slots?:PortfolioSnapshot['slots'];stashes?:PortfolioSnapshot['stashes']};
  check(record?.kind==='kadmeion-source-archive'&&record.formatVersion===1&&
    Array.isArray(record.files),'Unsupported project archive format.');
  const expected=record.files;
  check(expected.length===entries.size-1&&new Set(expected).size===expected.length,
    'Archive manifest and file count disagree.');
  const files:Record<string,string>={};
  for(const name of expected){
    check(typeof name==='string'&&name!==MANIFEST&&entries.has(name),'Archive file not declared.');
    try{files[name]=decoder.decode(entries.get(name)!.bytes);}
    catch{throw new ContractError('VALIDATION','Invalid project source UTF-8.');}
  }
  const snapshot:PortfolioSnapshot={formatVersion:1,files,
    slots:record.slots as PortfolioSnapshot['slots'],
    stashes:record.stashes as PortfolioSnapshot['stashes']};
  validateSnapshot(snapshot);
  return snapshot;
}


/**
 * Strict reader for bounded ZIP-STORE artifacts (including private recovery
 * bundles). Unlike the editor SOURCE importer, this accepts larger media
 * entries but never compression, encryption, extra fields, traversal aliases,
 * duplicate central references or unbounded inflation. It provides bytes,
 * not document provenance or permission to publish them.
 */
export function readStrictStoredZip(
  input:Uint8Array,limits:StoredZipLimits
):Map<string,Uint8Array>{
  check(input instanceof Uint8Array&&
    Number.isSafeInteger(limits.maxBytes)&&limits.maxBytes>22&&
    limits.maxBytes<=10*1024*1024&&
    Number.isSafeInteger(limits.maxEntries)&&limits.maxEntries>=1&&
    limits.maxEntries<=101&&Number.isSafeInteger(limits.maxEntryBytes)&&
    limits.maxEntryBytes>0&&limits.maxEntryBytes<=limits.maxBytes&&
    input.byteLength>=22&&input.byteLength<=limits.maxBytes,
    'Invalid ZIP size or resource limits.');
  const bytes=Uint8Array.from(input),view=new DataView(bytes.buffer);
  const end=bytes.length-22;
  check(view.getUint32(end,true)===0x06054b50&&
    view.getUint16(end+4,true)===0&&view.getUint16(end+6,true)===0&&
    view.getUint16(end+20,true)===0,'Missing or noncanonical ZIP footer.');
  const count=view.getUint16(end+10,true);
  const centralOffset=view.getUint32(end+16,true);
  const centralSize=view.getUint32(end+12,true);
  check(count>0&&count<=limits.maxEntries&&
    count===view.getUint16(end+8,true)&&centralOffset>=0&&
    centralOffset+centralSize===end,'Invalid ZIP directory bounds.');
  const local=new Map<string,{data:Uint8Array;crc:number;offset:number}>();
  let pos=0;
  while(pos<centralOffset){
    check(pos+30<=centralOffset&&view.getUint32(pos,true)===0x04034b50,
      'Invalid ZIP local record.');
    const flags=view.getUint16(pos+6,true),method=view.getUint16(pos+8,true),
      entryCrc=view.getUint32(pos+14,true),size=view.getUint32(pos+18,true),
      rawSize=view.getUint32(pos+22,true),nameLength=view.getUint16(pos+26,true),
      extra=view.getUint16(pos+28,true);
    check(view.getUint16(pos+4,true)===20&&flags===0x800&&method===0&&
      view.getUint16(pos+10,true)===0&&view.getUint16(pos+12,true)===0&&
      size===rawSize&&size<=limits.maxEntryBytes&&nameLength>0&&
      extra===0&&pos+30+nameLength+size<=centralOffset,
      'Unsupported or oversized ZIP local record.');
    const offset=pos,begin=pos+30,dataStart=begin+nameLength;
    let name:string;
    try{name=decoder.decode(bytes.subarray(begin,dataStart));}
    catch{throw new ContractError('VALIDATION','Invalid ZIP name encoding.');}
    check(name.length<=160&&
      /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(name)&&
      !name.includes('..')&&!name.includes('//')&&!name.endsWith('/')&&
      !name.split('/').includes('.')&&!local.has(name),
      'Unsafe or duplicate ZIP name.');
    const data=bytes.slice(dataStart,dataStart+size);
    check(crc32(data)===entryCrc,'ZIP file checksum disagrees with bytes.');
    local.set(name,{data,crc:entryCrc,offset});
    pos=dataStart+size;
  }
  check(pos===centralOffset&&local.size===count,'ZIP local header count mismatch.');
  const seen=new Set<string>();
  let cursor=centralOffset;
  for(let i=0;i<count;i++){
    check(cursor+46<=end&&view.getUint32(cursor,true)===0x02014b50&&
      view.getUint16(cursor+4,true)===20&&view.getUint16(cursor+6,true)===20&&
      view.getUint16(cursor+8,true)===0x800&&view.getUint16(cursor+10,true)===0&&
      view.getUint16(cursor+12,true)===0&&view.getUint16(cursor+14,true)===0&&
      view.getUint16(cursor+30,true)===0&&view.getUint16(cursor+32,true)===0,
      'Unsupported ZIP directory record.');
    const length=view.getUint16(cursor+28,true);
    check(length>0&&cursor+46+length<=end,'ZIP directory record exceeds file.');
    let name:string;
    try{name=decoder.decode(bytes.subarray(cursor+46,cursor+46+length));}
    catch{throw new ContractError('VALIDATION','Invalid central ZIP filename.');}
    const actual=local.get(name);
    check(actual&&!seen.has(name)&&
      actual.crc===view.getUint32(cursor+16,true)&&
      actual.data.length===view.getUint32(cursor+20,true)&&
      actual.data.length===view.getUint32(cursor+24,true)&&
      actual.offset===view.getUint32(cursor+42,true),
      'ZIP local and central records disagree.');
    seen.add(name);
    cursor+=46+length;
  }
  check(cursor===end&&seen.size===local.size,'Incomplete ZIP central directory.');
  return new Map([...local].map(([name,entry])=>[name,entry.data]));
}
