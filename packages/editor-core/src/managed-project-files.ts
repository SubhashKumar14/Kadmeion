import { ContractError } from '../../contracts/src/project.ts';
import type { PortfolioSnapshot } from './portfolio-revision-transactions.ts';

export const MAX_FILE_BYTES = 256 * 1024;
const managedPaths = [
  /^kadmeion\.json$/,
  /^kadmeion\.lock\.json$/,
  /^pages\/[a-z0-9_-]{1,64}\.page\.json$/,
  /^content\/[a-z0-9_-]{1,64}\.content\.json$/,
  /^theme\/tokens\.json$/
];

const PORTFOLIO_LAYOUTS = {
  'arc-hero@1':{renderId:'L1',slots:['title','text','cta1','cta2','note'],required:['title','text','cta1']},
  'collage-hero@1':{renderId:'L2',slots:['title','avatar','text','btn1','btn2','imageA','imageB','project'],required:['title','text']},
  'project-showcase@1':{renderId:'L3',slots:['thumbs','media','image','badge','title','meta','cta'],required:['title','image']},
  'editorial-bento@1':{renderId:'L4',slots:['title','media','text1','image','card','text2','cta'],required:['title','image']},
  'stepped-hero@1':{renderId:'L5',slots:['title','cta'],required:['title']},
  'skills@1':{renderId:'L6',slots:['title','items','note'],required:[]},
  'experience@1':{renderId:'L7',slots:['title','entries'],required:[]},
  'contact@1':{renderId:'L8',slots:['title','text','cta1','cta2','links'],required:[]}
} as const;
type PortfolioLayoutPin=keyof typeof PORTFOLIO_LAYOUTS;
export function portfolioLayout(pin:string):{renderId:string;slots:string[];required:string[]}|undefined {
  if(!Object.hasOwn(PORTFOLIO_LAYOUTS,pin))return undefined;
  const layout=PORTFOLIO_LAYOUTS[pin as PortfolioLayoutPin];
  return {renderId:layout.renderId,slots:[...layout.slots],required:[...layout.required]};
}
const presets = {
  arc:{header:'header-pill',sections:['arc-hero@1','project-showcase@1','editorial-bento@1','skills@1','contact@1']},
  collage:{header:'header-cta',sections:['collage-hero@1','project-showcase@1','experience@1','contact@1']},
  editorial:{header:'header-menu',sections:['editorial-bento@1','project-showcase@1','skills@1','contact@1']},
  stairs:{header:'header-menu',sections:['stepped-hero@1','editorial-bento@1','project-showcase@1','contact@1']},
  studio:{header:'header-full',sections:['arc-hero@1','project-showcase@1','experience@1','skills@1','contact@1']},
  blank:{header:null,sections:[]}
} as const satisfies Record<string,{header:string|null;sections:readonly PortfolioLayoutPin[]}>;
export type PortfolioPresetId=keyof typeof presets;

/**
 * The starter components are pinned library selections, not fictional author
 * content. Layout-only fields (avatars, screenshots, media and thumbnails)
 * stay EMPTY until the owner provides separately validated assets. Blank is
 * intentionally empty. Every selected S0 component still needs real content
 * before preflight can render or publish it.
 */
const CURATED_SLOT_COMPONENTS: Readonly<Record<string,string>> = Object.freeze({
  title:'title-stacked@1',
  text:'body-copy@1',text1:'body-copy@1',text2:'body-copy@1',
  note:'body-copy@1',
  cta:'external-link@1',cta1:'external-link@1',cta2:'external-link@1',
  btn1:'external-link@1',btn2:'external-link@1',
  project:'project-card@1',card:'project-card@1',
  items:'skills-list@1',entries:'skills-list@1',
  badge:'technology-tag@1',meta:'author-metric@1'
});

/**
 * Canonical, newly materialized reference implementations for the existing
 * trusted text-component pins. Their source bytes are fixed for this registry.
 * The S0 renderer still uses its own trusted data projection; these independent
 * TSX copies are for explicit private S1 customization and source export only.
 * They are not evidence of historic source bytes, arbitrary-code execution,
 * or safe publication. Image source is deliberately outside this registry.
 */
const CANONICAL_TEXT_COMPONENT_SOURCE:Readonly<Record<string,string>>=Object.freeze({
  "title-stacked@1": "import React from 'react';\nexport default function Heading({ title = '', subtitle = '' }: { title?: string; subtitle?: string }) {\n  return <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>;\n}\n",
  "body-copy@1": "import React from 'react';\nexport default function BodyCopy({ text = '' }: { text?: string }) {\n  return <p>{text}</p>;\n}\n",
  "external-link@1": "import React from 'react';\nfunction safeLink(value: string): string | undefined {\n  if (!value || value.length > 2048 || /[\\\\\\s\\u0000-\\u001f\\u007f]/u.test(value)) return undefined;\n  try {\n    const url = new URL(value);\n    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : undefined;\n  } catch { return undefined; }\n}\nexport default function ExternalLink({ label = '', url = '' }: { label?: string; url?: string }) {\n  const href = safeLink(url);\n  return href ? <a href={href} rel=\"noopener noreferrer nofollow\">{label}</a> : <span>{label}</span>;\n}\n",
  "project-card@1": "import React from 'react';\nfunction safeLink(value: string): string | undefined {\n  if (!value || value.length > 2048 || /[\\\\\\s\\u0000-\\u001f\\u007f]/u.test(value)) return undefined;\n  try {\n    const url = new URL(value);\n    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : undefined;\n  } catch { return undefined; }\n}\nexport default function ProjectCard({ title = '', summary = '', url = '' }: { title?: string; summary?: string; url?: string }) {\n  const href = safeLink(url);\n  return <article><h2>{title}</h2><p>{summary}</p>{href && <a href={href} rel=\"noopener noreferrer nofollow\">View project</a>}</article>;\n}\n",
  "skills-list@1": "import React from 'react';\nexport default function SkillsList({ items = '' }: { items?: string }) {\n  let entries: string[] = [];\n  try {\n    const value: unknown = JSON.parse(items);\n    if (Array.isArray(value) && value.length <= 24 && value.every(item => typeof item === 'string' && item.length <= 1200)) entries = value;\n  } catch { /* malformed authored list remains unrendered */ }\n  return <ul>{entries.map((item, index) => <li key={index}>{item}</li>)}</ul>;\n}\n",
  "technology-tag@1": "import React from 'react';\nexport default function TechnologyTag({ text = '' }: { text?: string }) {\n  return <span>{text}</span>;\n}\n",
  "author-metric@1": "import React from 'react';\nexport default function AuthorMetric({ label = '', value = '' }: { label?: string; value?: string }) {\n  return <dl><div><dt>{label}</dt><dd>{value}</dd></div></dl>;\n}\n"
});
export function canonicalLibraryComponentSource(pin:string):string|undefined{
  return Object.hasOwn(CANONICAL_TEXT_COMPONENT_SOURCE,pin)?CANONICAL_TEXT_COMPONENT_SOURCE[pin]:undefined;
}

/** Build an editable draft from the documented layout order and empty owner slots. */
export function createPortfolioPresetDraft(presetId:PortfolioPresetId):PortfolioSnapshot {
  if(typeof presetId!=='string'||!Object.hasOwn(presets,presetId))
    throw new ContractError('VALIDATION','Unknown portfolio preset.');
  const preset=presets[presetId];
  const slots:PortfolioSnapshot['slots']={};
  const sections=preset.sections.map(layout=>{
    const id=layout.split('@',1)[0];
    for(const name of PORTFOLIO_LAYOUTS[layout].slots) {
      const componentId=CURATED_SLOT_COMPONENTS[name];
      slots[id+'-'+name.toLowerCase()]=componentId
        ?{state:'S0',componentId,content:{}}
        :{state:'EMPTY',content:{}};
    }
    // The transaction journal already stores live assignments in snapshot.slots.
    return {id,layout,slotKeys:PORTFOLIO_LAYOUTS[layout].slots};
  });
  return {
    formatVersion:1,
    files:{
      'kadmeion.json':JSON.stringify({formatVersion:1,preset:presetId}),
      'pages/home.page.json':JSON.stringify({header:preset.header?{layout:preset.header+'@1'}:null,sections})
    },
    slots,stashes:{}
  };
}

export function assertManagedPath(path: string): void {
  if (typeof path !== 'string' || !managedPaths.some(rule => rule.test(path))) {
    throw new ContractError('VALIDATION', 'Not an approved managed project path.');
  }
}

export function assertOwnedSourcePath(path: string): void {
  const legacy = /^slots\/[a-z0-9_-]{1,64}\/index\.(tsx|css)$/;
  const versioned = /^slots\/[a-z0-9_-]{1,64}\/owned\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/component-source\.tsx$/;
  if (typeof path !== 'string' || !(legacy.test(path) || versioned.test(path))) {
    throw new ContractError('VALIDATION', 'Owned source must remain in its dedicated slot folder.');
  }
}

export function validateManagedJson(path: string, bytes: string): void {
  assertManagedPath(path);
  if (typeof bytes !== 'string' || new TextEncoder().encode(bytes).byteLength > MAX_FILE_BYTES) {
    throw new ContractError('VALIDATION', 'Managed JSON file exceeds its safe size limit.');
  }
  try {
    const parsed: unknown = JSON.parse(bytes);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected JSON object');
    }
    // Managed JSON is consumed by several editor lenses. Reject prototype
    // keys and pathological structures BEFORE they enter an application graph.
    // Do not rewrite, normalize or discard otherwise-valid unknown fields.
    const stack: Array<{value: unknown; depth: number}> = [{value: parsed, depth: 0}];
    let nodes = 0;
    while (stack.length) {
      const {value, depth} = stack.pop()!;
      if (++nodes > 8192 || depth > 32) throw new Error('Managed JSON complexity exceeded');
      if (value === null || typeof value !== 'object') continue;
      const entries = Object.entries(value);
      if (entries.length > 512) throw new Error('Managed JSON collection exceeded');
      for (const [key, child] of entries) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor' ||
            key.length > 256) throw new Error('Unsafe managed JSON property');
        stack.push({value: child, depth: depth + 1});
      }
    }
  } catch {
    throw new ContractError('VALIDATION', 'Managed file contains invalid or unsafe JSON; original bytes remain untouched.');
  }
}
