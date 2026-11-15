import {readFileSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';

/**
 * Verify the structural integrity of approval-to-code evidence. An existing
 * test path is a candidate, NOT accepted UAT or a provider-hosted proof.
 * Run this before any status roll-up or frontend handoff.
 */
const root=process.cwd();
const specifications=[
  {name:'D01-D90',file:'D01_D90_BACKEND_TRACEABILITY.csv',prefix:'D',digits:2,count:90,
    evidence:['Verified source paths (not acceptance proof)','Matching test paths (not end-to-end proof)']},
  {name:'UI-001..UI-115',file:'UI_001_115_BACKEND_EVIDENCE_2026-11-15.csv',
    prefix:'UI-',digits:3,count:115,
    evidence:['Backend source path','Relevant unit/integration suite']},
  {name:'WF-001..WF-053',file:'WORKFLOWS_BACKEND_EVIDENCE_2026-11-15.csv',
    prefix:'WF-',digits:3,count:53,
    evidence:['Verified backend source','Verified automated test source']},
  {name:'TC-001..TC-138',file:'TEST_CASES_BACKEND_EVIDENCE_2026-11-15.csv',
    prefix:'TC-',digits:3,count:138,
    evidence:['Backend candidate source (not per-case proof)','Automated suite candidate (not per-case proof)']},
  {name:'TP-01..TP-20',file:'TECHNICAL_PROOFS_BACKEND_EVIDENCE_2026-11-15.csv',
    prefix:'TP-',digits:2,count:20,
    evidence:['Known source','Local test candidate']}
];

function parseCsv(input) {
  const lines=[],row=[];let field='',quoted=false,atStart=true;
  const emitField=()=>{row.push(field);field='';atStart=true;};
  const emitRow=()=>{emitField();if(row.some(value=>value.length))lines.push(row.splice(0));else row.length=0;};
  const str=input.replace(/^\uFEFF/,'');
  for(let i=0;i<str.length;i++){
    const ch=str[i];
    if(quoted){
      if(ch==='"'&&str[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else if(ch==='"'&&atStart){quoted=true;atStart=false;}
    else if(ch===',')emitField();
    else if(ch==='\r'||ch==='\n'){
      if(ch==='\r'&&str[i+1]==='\n')i++;
      emitRow();
    }else{field+=ch;atStart=false;}
  }
  if(quoted)throw new Error('Unclosed quoted CSV field');
  if(field!==''||row.length)emitRow();
  return lines;
}

let failures=0;
const fail=(message)=>{console.error('Traceability: '+message);failures++;};
for(const specification of specifications){
  const location=resolve(root,'project-docs/registers',specification.file);
  const rows=parseCsv(readFileSync(location,'utf8'));
  if(rows.length===0){fail(specification.name+' has no header');continue;}
  const [header,...items]=rows;
  if(header.length!==new Set(header).size)fail(specification.name+' has duplicate CSV headers');
  const evidenceColumns=specification.evidence.map(name=>header.indexOf(name));
  if(evidenceColumns.some(i=>i<0))fail(specification.name+' missing evidence column');
  if(items.length!==specification.count)
    fail(specification.name+' expected '+specification.count+' rows, got '+items.length);
  const seen=new Set();
  for(const [index,row] of items.entries()){
    const id=row[0];
    if(row.length!==header.length){fail(specification.name+' malformed row '+(index+2));continue;}
    if(seen.has(id))fail(specification.name+' duplicate ID '+id);
    seen.add(id);
    if(row[1].trim()==='')fail(specification.name+' has an empty requirement '+id);
    for(const col of evidenceColumns){
      if(col<0)continue;
      for(const path of row[col].split(';').map(value=>value.trim()).filter(Boolean)){
        if(path.startsWith('/')||path.includes('\\')||path.split('/').includes('..')){
          fail(specification.name+' unsafe evidence path in '+id);continue;
        }
        const target=resolve(root,path);
        if(!target.startsWith(root+sep)||!existsSync(target))
          fail(specification.name+' missing evidence '+id+' -> '+path);
      }
    }
  }
  for(let n=1;n<=specification.count;n++){
    const id=specification.prefix+String(n).padStart(specification.digits,'0');
    if(!seen.has(id))fail(specification.name+' missing decision '+id);
  }
  if(specification.prefix==='D'){
    const status=header.indexOf('Backend code status');
    const allowed=new Set(['IMPLEMENTED_AND_TESTED','IMPLEMENTED_NOT_VERIFIED',
      'PARTIAL','MISSING','BLOCKED_EXTERNAL','DEFERRED_APPROVED','NOT_APPLICABLE']);
    if(status<0)fail(specification.name+' missing backend status column');
    else for(const row of items)if(!allowed.has(row[status]))
      fail(specification.name+' unknown decision status '+row[0]);
  }
  console.log('Traceability inventory: '+specification.name+
    ' | '+items.length+' records | source links checked (not acceptance proof)');
}
if(failures)process.exitCode=1;
else console.log('Traceability inventories structurally valid; acceptance remains independently gated.');
