/** F0 audit: all approved screen->spec->action->brand sources, not product acceptance. */
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
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
 const code=a['Implementation source reviewed at 6425c277'];
 if(code&&!existsSync(resolve(base,code)))throw Error('Missing actual code trace '+code);
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