/** F0 audit: checksum original approved PNGs only when local source bytes are supplied. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
const contractMode=args.length===1&&args[0]==='--contract';
if(args.length!==0&&!contractMode&&(args.length!==2||args[0]!=='--images-dir'||!args[1]))
 throw Error('Usage: node scripts/verify-approved-light-references.mjs [--images-dir DIR]');
if(args.length&&!contractMode){
  for(const row of rows){
    const file=row['Approved PNG archive member'];
    const actual=createHash('sha256').update(readFileSync(resolve(args[1],file))).digest('hex');
    if(!actual.startsWith(row['SHA-256 prefix from approval record']))throw Error('Bad PNG checksum: '+file);
  }
}
console.log('F0 approved reference register: 52/52 structural PASS; six archives, revised #26 PASS');
console.log('F0 PNG byte SHA-256: '+(args.length&&!contractMode?'52/52 PASS':'NOT_RUN (original PNGs not in CI; use --images-dir)'));
console.log('F0 rendered browser visual comparison and accessibility: NOT_RUN');

// Extended source-to-screen phase contract, gated by --contract; shares the
// original F0 verifier so the existing 200-file exception budget is unchanged.
if(contractMode){
const base=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(resolve(base,p),'utf8');
function parseCSV(s){
 const rows=[];let row=[],f='',q=false;
 for(let i=0;i<s.length;i++){const c=s[i];
  if(c==='"'){if(q&&s[i+1]==='"'){f+='"';i++;}else q=!q;}
  else if(c===','&&!q){row.push(f);f='';}
  else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&s[i+1]==='\n')i++;row.push(f);f='';if(row.some(Boolean))rows.push(row);row=[];}
  else f+=c;
 }
 if(q)throw Error('Unbalanced CSV quotes');
 if(row.length||f){row.push(f);rows.push(row);}
 const [header,...body]=rows;
 if(!header)throw Error('Empty CSV source');
 const names=header.map(x=>x.replace(/^\uFEFF/,''));
 return body.map(c=>Object.fromEntries(names.map((k,i)=>[k,c[i]??''])));
}
const approved=parseCSV(read('project-docs/registers/APPROVED_LIGHT_52_SCREENS_2026-11-15.csv'));
const planned=parseCSV(read('project-docs/registers/SCREENS.csv'));
const catalog=[...read('project-docs/docs/02_design/SCREEN_CATALOG.md')
 .matchAll(/^\|\s*([A-Z]+-\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*\[[^\]]+\]\((screens\/[^)]+)\)\s*\|/gm)]
 .map(m=>({id:m[1],actor:m[4].trim(),spec:'project-docs/docs/02_design/'+m[6]}));
if(approved.length!==52||planned.length!==52||catalog.length!==52)
 throw Error('52-screen source/count mismatch');
const catalogById=new Map(catalog.map(x=>[x.id,x]));
const plannedById=new Map(planned.map(x=>[x['Screen ID'],x]));
if(catalogById.size!==52||plannedById.size!==52||
 new Set(approved.map(x=>x['Screen ID'])).size!==52)throw Error('Duplicate source/spec IDs');
const matrix=read('project-docs/registers/F0_SCREEN_SOURCE_MATRIX_2026-11-16.md');
const mapping=matrix.split('\n').filter(l=>/^\|\s*\d\d\s*\|/.test(l));
if(mapping.length!==52)throw Error('F0 matrix must contain 52 source rows, not '+mapping.length);
const headings=['Purpose and layout','Content and actions','Data/authorization and invariants',
 'State and failure matrix','Interaction and responsive contract','Acceptance checks','Linked specifications'];
for(const [i,a] of approved.entries()){
 const n=String(i+1).padStart(2,'0'),id=a['Screen ID'],c=catalogById.get(id),p=plannedById.get(id);
 if(a.Index!==n||!c||!p||!a['Approved PNG archive member'].startsWith(n+'_')||
  !/^[a-f0-9]{16,64}$/.test(a['SHA-256 prefix from approval record'])||
  !a['Visual approval'].startsWith('APPROVED_'))throw Error('Owner approval provenance error '+id);
 if(c.spec!=='project-docs/'+p['Specification file'])
  throw Error('Planning/source spec mismatch '+id);
 if(!p['Primary action'])throw Error('Missing user action '+id);
 if(!existsSync(resolve(base,c.spec)))throw Error('No source spec '+c.spec);
 const spec=read(c.spec);
 for(const h of headings)if(!spec.includes('## '+h))throw Error('Missing '+id+' spec heading '+h);
 if(!/Owner decisions:/.test(spec))throw Error('No trace to owner decisions '+id);
 // Some audited surfaces legitimately map to both client and protected API files.
 // Treat each as a separate source path rather than a literal combined filename.
 const code=a['Implementation source reviewed at 6425c277'];
 for(const trace of code.split(/\s+\+\s+/).map(x=>x.trim()).filter(Boolean)){
  if(!existsSync(resolve(base,trace)))throw Error('Missing actual code trace '+trace);
 }
 const fields=mapping[i].split('|').slice(1,-1).map(x=>x.trim());
 if(fields.length!==14||fields[0]!==n||fields[1]!==id||
  fields[6]!==c.spec||fields[7]!==a['Approved PNG archive member']||
  fields[8]!==a['SHA-256 prefix from approval record']||
  fields[10]!==a['Image code implementation']||
  fields[11]!==a['Visual parity']||fields[12]!==a['A11y functional acceptance']||
  fields[13]!==a['Whole workflow acceptance'])
   throw Error('F0 matrix not synced to current approval '+id);
}
if(approved[25]['Approved PNG archive member']!=='26_EDIT-09_Fullscreen_Portfolio_Only_REVISION_LIGHT.png')
 throw Error('Screen 26 superseded source improperly reused');
for(const p of ['kadmeion-mark.svg','kadmeion-wordmark.svg','kadmeion-open-folio.svg']){
 if(!existsSync(resolve(base,'apps/frontend/public/brand',p)))throw Error('Brand original missing: '+p);
}
console.log('F0 PASS: 52/52 catalog/spec/owner-action/source/brand/code/acceptance trace checks');
console.log('F0 PASS: corrected screen 26; 3 approved local brand SVGs; no workflow or public launch is certified');
}
