import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const ruleTags = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
// Gate deterministic regressions in the scanned fixture states. Axe
// reports ambiguous results separately for manual review.
const blockingRules = new Set(['button-name','link-name','label','image-alt','html-has-lang','document-title',
  'dlitem','scrollable-region-focusable','color-contrast','label-content-name-mismatch']);

export async function auditAccessibility(page:Page, state:string, directory?:string) {
  if (!await page.evaluate(()=>!!window.axe)) await page.addScriptTag({path:axePath});
  const evidence=await page.evaluate(async tags=>{
    await document.fonts.ready;
    const animations=document.getAnimations().filter(animation=>{
      const endTime=animation.effect?.getComputedTiming().endTime;
      return animation.playState==='running'&&typeof endTime==='number'&&endTime<=500;
    });
    await Promise.allSettled(animations.map(animation=>animation.finished));

    const result:AxeResults=await window.axe.run(document,{
      runOnly:{type:'tag',values:tags},
      resultTypes:['violations','incomplete','passes']
    });
    // Report only source-defined element/class hints. Omit DOM snippets,
    // identifiers, text, field values and URLs that can contain owner data.
    function component(target:unknown) {
      if(typeof target!=='string') return null;
      try {
        const element=document.querySelector(target);
        if(!element) return null;
        const classes=[...element.classList].filter(name=>/^[a-z][a-z0-9-]{0,42}$/.test(name));
        return element.localName+classes.map(name=>'.'+name).join('');
      } catch {return null;}
    }
    return {
      viewport:{width:window.innerWidth,height:window.innerHeight},
      theme:document.documentElement.dataset.theme??'light',
      violations:result.violations.map(({id,impact,nodes})=>({id,impact,affected:nodes.length,
        components:[...new Set(nodes.map(node=>component(node.target[0])).filter(Boolean))]})),
      review:result.incomplete.map(({id,nodes})=>({id,affected:nodes.length})),
      passed:result.passes.map(({id})=>id)
    };
  },ruleTags);
  if(directory){
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,state+'.a11y.json'),JSON.stringify({state,...evidence},null,2)+'\n');
  }
  expect(evidence.violations.filter(item=>blockingRules.has(item.id)),state+' accessibility regression rules').toEqual([]);
}
