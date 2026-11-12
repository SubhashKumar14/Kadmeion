import { ContractError } from '../../contracts/src/project.ts';
import { validateSnapshot, type PortfolioSnapshot } from '../../editor-core/src/index.ts';

/** Portable data contract, not a ZIP file or static published portfolio. */
export function exportPortableSnapshot(snapshot:PortfolioSnapshot):string {
  validateSnapshot(snapshot);
  const text=JSON.stringify({formatVersion:1,kind:'kadmeion-private-project',snapshot});
  if(new TextEncoder().encode(text).byteLength>1024*1024)
    throw new ContractError('VALIDATION','Portable project exceeds the current safe export limit.');
  return text;
}

export function importPortableSnapshot(payload:string):PortfolioSnapshot {
  if(typeof payload!=='string'||new TextEncoder().encode(payload).byteLength>1024*1024)
    throw new ContractError('VALIDATION','Invalid project import size.');
  let parsed:unknown;
  try{parsed=JSON.parse(payload);}catch{
    throw new ContractError('VALIDATION','Invalid portable project JSON.');
  }
  const p=parsed as {kind?:unknown;formatVersion?:unknown;snapshot?:PortfolioSnapshot}|null;
  if(!p||p.kind!=='kadmeion-private-project'||p.formatVersion!==1||!p.snapshot)
    throw new ContractError('VALIDATION','Unsupported project format.');
  validateSnapshot(p.snapshot);
  return structuredClone(p.snapshot);
}
