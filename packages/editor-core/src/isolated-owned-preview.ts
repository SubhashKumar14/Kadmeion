import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {validateSnapshot,type PortfolioSnapshot} from './portfolio-revision-transactions.ts';

export type OwnedPreviewBlock={kind:'heading'|'paragraph';text:string};
export type OwnedPreviewResult=
  | {status:'PREVIEW_ONLY';blocks:OwnedPreviewBlock[];publicServingAllowed:false}
  | {status:'REJECTED';reason:'INVALID_INPUT'|'SCRIPT_FAILED'|'INVALID_OUTPUT'|'ENGINE_UNAVAILABLE'};

const MAX_SOURCE_BYTES=32_768;
const MAX_INPUT_BYTES=8192;
const MAX_OUTPUT_BYTES=8192;
const encoder=new TextEncoder();
const WORKER_KIND='kadmeion-owned-preview-v1';
const WORKER_TIMEOUT_MS=2500;

function previewBlocks(value:unknown):OwnedPreviewBlock[]|null {
  if(!Array.isArray(value)||value.length<1||value.length>12)return null;
  const blocks:OwnedPreviewBlock[]=[];
  for(const block of value){
    if(!block||typeof block!=='object'||Array.isArray(block)||
       Object.keys(block).sort().join(',')!=='kind,text')return null;
    const {kind,text}=block;
    if((kind!=='heading'&&kind!=='paragraph')||typeof text!=='string'||!text.trim()||
       text.length>(kind==='heading'?120:1200)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))return null;
    blocks.push({kind,text});
  }
  return blocks;
}

/**
 * Private, data-only custom JS preview. QuickJS receives only explicitly
 * selected strings and no host functions, resolver, module loader, DOM, or
 * network. Output must be treated as text by the caller. It cannot grant
 * publication or approve arbitrary JSX/browser execution.
 */
export async function evaluateOwnedPreview(source:string, input:Readonly<Record<string,string>>):
  Promise<OwnedPreviewResult>{
  if(typeof source!=='string'||source.length>MAX_SOURCE_BYTES||
     encoder.encode(source).length>MAX_SOURCE_BYTES||!source.trim()||
     !input||typeof input!=='object'||Array.isArray(input))
    return {status:'REJECTED',reason:'INVALID_INPUT'};
  const entries=Object.entries(input);
  if(entries.length>16||entries.some(([key,value])=>!/^\w{1,40}$/.test(key)||
     key==='__proto__'||key==='constructor'||key==='prototype'||
     typeof value!=='string'||value.length>1200))
    return {status:'REJECTED',reason:'INVALID_INPUT'};
  const inputJson=JSON.stringify(Object.fromEntries(entries));
  if(encoder.encode(inputJson).length>MAX_INPUT_BYTES)
    return {status:'REJECTED',reason:'INVALID_INPUT'};

  return new Promise<OwnedPreviewResult>(resolve=>{
    let worker:Worker;
    try{
      worker=new Worker(new URL(import.meta.url),{
        workerData:{kind:WORKER_KIND,source,inputJson},
        env:{},
        resourceLimits:{maxOldGenerationSizeMb:32,maxYoungGenerationSizeMb:8,stackSizeMb:2}
      });
    }catch{
      resolve({status:'REJECTED',reason:'ENGINE_UNAVAILABLE'});
      return;
    }
    let settled=false;
    const finish=(result:OwnedPreviewResult)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      void worker.terminate().catch(()=>{});
      resolve(result);
    };
    const timer=setTimeout(()=>finish({status:'REJECTED',reason:'SCRIPT_FAILED'}),WORKER_TIMEOUT_MS);
    worker.once('message',finish);
    worker.once('error',()=>finish({status:'REJECTED',reason:'ENGINE_UNAVAILABLE'}));
    worker.once('exit',()=>finish({status:'REJECTED',reason:'ENGINE_UNAVAILABLE'}));
  });
}

/** Read the active owner-controlled slot from a validated local draft. */
export async function evaluateOwnedSlotPreview(snapshot:PortfolioSnapshot,slotKey:string):
  Promise<OwnedPreviewResult>{
  try{validateSnapshot(snapshot);}
  catch{return {status:'REJECTED',reason:'INVALID_INPUT'};}
  const slot=Object.hasOwn(snapshot.slots,slotKey)?snapshot.slots[slotKey]:null;
  if(!slot||!['S1','S2'].includes(slot.state)||!slot.sourcePath)
    return {status:'REJECTED',reason:'INVALID_INPUT'};
  return evaluateOwnedPreview(snapshot.files[slot.sourcePath],slot.content);
}

async function runInVirtualMachine(source:string,inputJson:string):Promise<OwnedPreviewResult>{
  const {newQuickJSWASMModuleFromVariant}=await import('quickjs-emscripten-core');
  const module=await newQuickJSWASMModuleFromVariant(import('@jitl/quickjs-wasmfile-release-sync'));
  const runtime=module.newRuntime();
  try{
    runtime.setMemoryLimit(8*1024*1024);
    runtime.setMaxStackSize(256*1024);
    const vm=runtime.newContext();
    try{
      const deadline=performance.now()+75;
      runtime.setInterruptHandler(()=>performance.now()>deadline);
      const result=vm.evalCode(
        '((stringify,bindings)=>stringify((function(input){"use strict";\n'+source+
        '\n})(bindings)))(JSON.stringify,JSON.parse('+JSON.stringify(inputJson)+'))',
        'portfolio-preview.js',{type:'global'});
      if(result.error){
        result.error.dispose();
        return {status:'REJECTED',reason:'SCRIPT_FAILED'};
      }
      try{
        if(vm.typeof(result.value)!=='string')return {status:'REJECTED',reason:'INVALID_OUTPUT'};
        const raw=vm.getString(result.value);
        if(raw.length>MAX_OUTPUT_BYTES||encoder.encode(raw).length>MAX_OUTPUT_BYTES)
          return {status:'REJECTED',reason:'INVALID_OUTPUT'};
        const blocks=previewBlocks(JSON.parse(raw));
        return blocks?{status:'PREVIEW_ONLY',blocks,publicServingAllowed:false}:
          {status:'REJECTED',reason:'INVALID_OUTPUT'};
      }finally{result.value.dispose();}
    }finally{vm.dispose();}
  }catch{
    return {status:'REJECTED',reason:'SCRIPT_FAILED'};
  }finally{runtime.dispose();}
}


if(!isMainThread&&workerData?.kind===WORKER_KIND&&parentPort){
  let result:OwnedPreviewResult;
  try{result=await runInVirtualMachine(workerData.source,workerData.inputJson);}
  catch{result={status:'REJECTED',reason:'ENGINE_UNAVAILABLE'};}
  parentPort.postMessage(result);
}
