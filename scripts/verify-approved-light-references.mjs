/** F0 audit: checksum original approved PNGs only when local source bytes are supplied. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const source=readFileSync(resolve(fileURLToPath(new URL('../project-docs/registers/APPROVED_LIGHT_52_SCREENS_2026-11-15.csv',import.meta.url))),'utf8');
function csv(source){
  const result=[];let row=[],field='',quote=false;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(c==='"'){if(quote&&source[i+1]==='"'){field+='"';i++;}else quote=!quote;}
    else if(c===','&&!quote){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&source[i+1]==='\n')i++;row.push(field);field='';if(row.some(Boolean))result.push(row);row=[];}
    else field+=c;
  }
  if(quote)throw Error('Invalid CSV quotes');
  if(row.length||field){row.push(field);result.push(row);}
  return result;
}
const lines=csv(source),header=lines.shift();
if(!header)throw Error('Missing approval register');
const columns=['Index','Screen ID','Source archive in ChatGPT Library','Approved PNG archive member','SHA-256 prefix from approval record','Visual approval'];
for(const key of columns)if(!header.includes(key))throw Error('Approval column missing: '+key);
const rows=lines.map(values=>Object.fromEntries(header.map((key,i)=>[key,values[i]??''])));
if(rows.length!==52)throw Error('Expected exactly 52 approved screen records');
const archives=new Set(),names=new Set();
for(const [n,r] of rows.entries()){
  const index=String(n+1).padStart(2,'0'),name=r['Approved PNG archive member'],digest=r['SHA-256 prefix from approval record'];
  if(r.Index!==index||!name.startsWith(index+'_')||!name.endsWith('.png')||name!==basename(name)||names.has(name))
    throw Error('Bad or duplicate approved asset: '+index);
  if(!/^[a-f0-9]{16,64}$/.test(digest)||!r['Visual approval'].startsWith('APPROVED_'))throw Error('Missing approval/digest '+index);
  archives.add(r['Source archive in ChatGPT Library']);names.add(name);
}
if(archives.size!==6)throw Error('Expected six distinct approved source ZIPs');
if(rows[25]['Approved PNG archive member']!=='26_EDIT-09_Fullscreen_Portfolio_Only_REVISION_LIGHT.png'||
 !rows[25]['SHA-256 prefix from approval record'].startsWith('e13f8330cbc0149a1e11'))throw Error('Corrected #26 was replaced');
const args=process.argv.slice(2);
if(args.length!==0&&(args.length!==2||args[0]!=='--images-dir'||!args[1]))
 throw Error('Usage: node scripts/verify-approved-light-references.mjs [--images-dir DIR]');
if(args.length){
  for(const row of rows){
    const file=row['Approved PNG archive member'];
    const actual=createHash('sha256').update(readFileSync(resolve(args[1],file))).digest('hex');
    if(!actual.startsWith(row['SHA-256 prefix from approval record']))throw Error('Bad PNG checksum: '+file);
  }
}
console.log('F0 approved reference register: 52/52 structural PASS; six archives, revised #26 PASS');
console.log('F0 PNG byte SHA-256: '+(args.length?'52/52 PASS':'NOT_RUN (original PNGs not in CI; use --images-dir)'));
console.log('F0 rendered browser visual comparison and accessibility: NOT_RUN');
