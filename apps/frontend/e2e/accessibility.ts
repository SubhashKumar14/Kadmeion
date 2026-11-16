import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const ruleTags = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
// Gate straightforward name and label regressions. Other reported results
// require review of context or rendered appearance before sign-off.
const blockingRules = new Set(['button-name','link-name','label','image-alt','html-has-lang','document-title']);

export async function auditAccessibility(page:Page, state:string, directory?:string) {
  if (!await page.evaluate(()=>!!window.axe)) await page.addScriptTag({path:axePath});
  const evidence=await page.evaluate(async tags=>{
    const result:AxeResults=await window.axe.run(document,{
      runOnly:{type:'tag',values:tags},
      resultTypes:['violations','incomplete','passes']
    });
    // Store only rule identifiers and counts. DOM snippets, names, field
    // values and URLs can contain owner data and are unnecessary for this ledger.
    return {
      viewport:{width:window.innerWidth,height:window.innerHeight},
      theme:document.documentElement.dataset.theme??'light',
      violations:result.violations.map(({id,impact,nodes})=>({id,impact,affected:nodes.length})),
      review:result.incomplete.map(({id,nodes})=>({id,affected:nodes.length})),
      passed:result.passes.map(({id})=>id)
    };
  },ruleTags);
  if(directory){
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,state+'.a11y.json'),JSON.stringify({state,...evidence},null,2)+'\n');
  }
  expect(evidence.violations.filter(item=>blockingRules.has(item.id)),state+' accessible names and labels').toEqual([]);
}
