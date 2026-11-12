import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSaveCoordinator } from '../../packages/storage-adapters/src/editor-save-coordinator.ts';
import { createEditorHead, applyEditorTransaction } from '../../packages/editor-core/src/index.ts';

const portfolioId='00000000-0000-4000-8000-000000000001';
const opId='00000000-0000-4000-8000-000000000002';
const head=()=>{
  const initial=createEditorHead({
    formatVersion:1,
    files:{'kadmeion.json':'{"formatVersion":1}'},
    slots:{hero:{state:'S0',componentId:'heading@1',content:{title:'First'}}},
    stashes:{}
  });
  return applyEditorTransaction(initial,{operationId:opId,baseRevision:0,
    intent:{kind:'UPDATE_CONTENT',slotKey:'hero',content:{title:'Second'}}});
};

test('cloud save is reported only after durable local and matching cloud acknowledgements',async()=>{
  const order:string[]=[];
  const coordinator=new EditorSaveCoordinator(
    {save: async()=>{order.push('local');}},
    {commit: async()=>{order.push('cloud');return {portfolioId,revision:1,snapshotSha256:'a'.repeat(64),alreadyCommitted:false};}}
  );
  const result=await coordinator.save('user',portfolioId,opId,head(),null);
  assert.equal(result.status,'CLOUD_SAVED');
  assert.deepEqual(order,['local','cloud']);
});

test('failed local save cannot trigger a cloud write',async()=>{
  let calls=0;
  const coordinator=new EditorSaveCoordinator(
    {save:async()=>{throw Error('quota');}},
    {commit:async()=>{calls++;throw Error('should not call cloud');}}
  );
  const result=await coordinator.save('user',portfolioId,opId,head(),null);
  assert.equal(result.status,'LOCAL_FAILED');
  assert.equal(calls,0);
});

test('offline or conflict retains local draft without reporting cloud success',async()=>{
  const cloud={commit:async()=>{throw Object.assign(new Error('stale'),{code:'REVISION_CONFLICT'});}};
  const coordinator=new EditorSaveCoordinator({save:async()=>{}},cloud);
  const result=await coordinator.save('user',portfolioId,opId,head(),null);
  assert.equal(result.status,'CLOUD_CONFLICT');
  const retry=await coordinator.retryCloud(portfolioId,opId,head());
  assert.equal(retry.status,'CLOUD_CONFLICT');
});

test('remote acknowledgement with the wrong revision is never accepted',async()=>{
  const coordinator=new EditorSaveCoordinator({save:async()=>{}},{
    commit:async()=>({portfolioId,revision:100,snapshotSha256:'b'.repeat(64),alreadyCommitted:false})
  });
  const result=await coordinator.save('user',portfolioId,opId,head(),null);
  assert.equal(result.status,'LOCAL_ONLY');
});

test('offline cloud writes remain local and can be retried',async()=>{
  let attempts=0;
  const coordinator=new EditorSaveCoordinator({save:async()=>{}},{
    commit:async()=>{attempts++;if(attempts===1)throw Error('network');
      return {portfolioId,revision:1,snapshotSha256:'a'.repeat(64),alreadyCommitted:true};
    }
  });
  assert.equal((await coordinator.save('user',portfolioId,opId,head(),null)).status,'LOCAL_ONLY');
  assert.equal((await coordinator.retryCloud(portfolioId,opId,head())).status,'CLOUD_SAVED');
});
