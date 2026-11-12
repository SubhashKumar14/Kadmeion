import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError, normalizeProjectDraft } from '../../packages/contracts/src/index.ts';

const valid = {slug:'my-first-project',title:'  Case Study  ',summary:'  Summary ',description:'',repositoryUrl:'https://github.com/example/repo',liveUrl:null};

test('private project draft accepts valid link-only project and normalizes whitespace', () => {
  assert.deepEqual(normalizeProjectDraft(valid), {
    slug: 'my-first-project', title: 'Case Study', summary: 'Summary', description: '',
    repositoryUrl: 'https://github.com/example/repo', liveUrl: null
  });
});

test('project slugs, title, URL protocols and private destinations are rejected', () => {
  for (const changes of [
    {slug:'../escape'}, {slug:'X-Case'}, {slug:'--foo'}, {slug:'ok'},
    {title:' '}, {title:'x'.repeat(121)}, {liveUrl:'javascript:alert(1)'},
    {repositoryUrl:'https://127.0.0.1/admin'}, {liveUrl:'http://example.com'}
  ]) assert.throws(() => normalizeProjectDraft({...valid,...changes}), ContractError);
});
