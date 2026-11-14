import { ContractError } from './project.ts';

export type CaseStudySectionKind='challenge'|'approach'|'implementation'|'results'|'media'|'custom';
export interface CaseStudySection {
  id:string;
  kind:CaseStudySectionKind;
  title:string;
  body:string;
  visible:boolean;
}
export interface PrivateCaseStudy {
  sections:CaseStudySection[];
}
const kindSet=new Set<CaseStudySectionKind>(['challenge','approach','implementation','results','media','custom']);

export function normalizePrivateCaseStudy(raw:unknown):PrivateCaseStudy {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ContractError('VALIDATION','Case study must be an object.');
  const record=raw as Record<string,unknown>;
  if(!Array.isArray(record.sections)||record.sections.length>24)
    throw new ContractError('VALIDATION','Case study accepts at most 24 sections.');
  const seen=new Set<string>();
  const sections:CaseStudySection[]=[];
  for(const item of record.sections) {
    if(!item||typeof item!=='object'||Array.isArray(item))
      throw new ContractError('VALIDATION','Invalid case-study section.');
    const s=item as Record<string,unknown>;
    if(typeof s.id!=='string'||!/^[a-z0-9_-]{1,64}$/.test(s.id)||seen.has(s.id)||
       typeof s.kind!=='string'||!kindSet.has(s.kind as CaseStudySectionKind)||
       typeof s.title!=='string'||s.title.length>120||
       typeof s.body!=='string'||s.body.length>12000||typeof s.visible!=='boolean') {
      throw new ContractError('VALIDATION','Invalid, oversized or duplicate section.');
    }
    seen.add(s.id);
    sections.push({id:s.id,kind:s.kind as CaseStudySectionKind,title:s.title,body:s.body,visible:s.visible});
  }
  const result={sections};
  if(new TextEncoder().encode(JSON.stringify(result)).byteLength>100000)
    throw new ContractError('VALIDATION','Case study exceeds total size limit.');
  return result;
}
