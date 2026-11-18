import { ContractError } from '../../contracts/src/project.ts';
import { assertOwnedSourcePath, validateSnapshot, type EditorHead, type PortfolioSnapshot } from '../../editor-core/src/index.ts';

/**
 * Explicit device-local recovery copy. Cloud base and the optional cloud
 * operation are retained as provenance, not authorization or a retry grant.
 * Invalid/unapplied inspector and owned-source strings are opaque here.
 * Never store provider session credentials in this envelope.
 */
export interface EditorRecoveryPayload {
  formatVersion: 1;
  cloudBaseRevision: number;
  /** Older v1 copies remain readable; new editor writes include the local counter. */
  localRevision?: number;
  cloudOperationId: string | null;
  snapshot: PortfolioSnapshot;
  fieldDrafts: Record<string,string>;
  sourceDrafts: Record<string,string>;
  seoDraft: {title:string;description:string} | null;
}
export interface EditorRecoverySummary {
  copyId: string;
  savedAt: number;
  cloudBaseRevision: number;
  /** Only mutable, per-mounted-editor checkpoint rows have a sequence. */
  checkpointSequence?: number;
}
export interface EditorRecoveryCopy extends EditorRecoverySummary {
  ownerId: string;
  portfolioId: string;
  payload: EditorRecoveryPayload;
}

const RECOVERY_STORE='recovery-copies';
const RECOVERY_INDEX='owner-portfolio';
export const MAX_RECOVERY_COPIES=8;
export const MAX_RECOVERY_BYTES=8*1024*1024;
const RECOVERY_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const recoveryFailure=(message:string)=>new ContractError('VALIDATION',message);
function assertRecoveryId(value:string):void {
  if(typeof value!=='string'||!RECOVERY_ID.test(value))
    throw recoveryFailure('Invalid private recovery identity.');
}
function isPlainRecord(value:unknown):value is Record<string,unknown> {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&
    (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
}
function exactKeys(value:Record<string,unknown>,keys:readonly string[]):boolean {
  return Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}
function validateRecoveryStrings(value:unknown,limit:number,checkKey:(key:string)=>void):void {
  if(!isPlainRecord(value)||Object.keys(value).length>limit)
    throw recoveryFailure('Invalid recovery buffer map.');
  for(const [key,text] of Object.entries(value)){
    checkKey(key);
    if(typeof text!=='string')throw recoveryFailure('Recovery buffers must be text.');
  }
}
function validateRecoveryPayload(value:EditorRecoveryPayload):void {
  if(!isPlainRecord(value)||!exactKeys(value,[
    'formatVersion','cloudBaseRevision','cloudOperationId','snapshot','fieldDrafts','sourceDrafts','seoDraft',
    ...(Object.hasOwn(value,'localRevision')?['localRevision']:[])
  ])||value.formatVersion!==1||!Number.isSafeInteger(value.cloudBaseRevision)||value.cloudBaseRevision<0||
     (Object.hasOwn(value,'localRevision')&&
      (!Number.isSafeInteger(value.localRevision)||typeof value.localRevision!=='number'||value.localRevision<0)))
    throw recoveryFailure('Invalid recovery payload.');
  if(value.cloudOperationId!==null)assertRecoveryId(value.cloudOperationId);
  validateSnapshot(value.snapshot);
  validateRecoveryStrings(value.fieldDrafts,500,key=>{
    if(!/^[a-z0-9_-]{1,64}:[a-z0-9_-]{1,64}$/.test(key))
      throw recoveryFailure('Invalid recovery field key.');
  });
  validateRecoveryStrings(value.sourceDrafts,100,assertOwnedSourcePath);
  if(value.seoDraft!==null&&(!isPlainRecord(value.seoDraft)||
     !exactKeys(value.seoDraft,['title','description'])||
     typeof value.seoDraft.title!=='string'||typeof value.seoDraft.description!=='string'))
    throw recoveryFailure('Invalid recovery metadata buffer.');
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>MAX_RECOVERY_BYTES)
    throw recoveryFailure('Recovery copy exceeds the browser storage limit. Preserve or export your edits before leaving.');
}
function validateStoredRecovery(value:unknown,ownerId:string,portfolioId:string,copyId?:string):EditorRecoveryCopy {
  if(!isPlainRecord(value)||!exactKeys(value,['ownerId','portfolioId','copyId','savedAt','cloudBaseRevision','payload',
     ...(Object.hasOwn(value,'checkpointSequence')?['checkpointSequence']:[])])||
     (Object.hasOwn(value,'checkpointSequence')&&
       (typeof value.checkpointSequence!=='number'||!Number.isSafeInteger(value.checkpointSequence)||value.checkpointSequence<1))||
     value.ownerId!==ownerId||value.portfolioId!==portfolioId||typeof value.copyId!=='string'||
     (copyId!==undefined&&value.copyId!==copyId)||typeof value.savedAt!=='number'||
     !Number.isSafeInteger(value.savedAt)||value.savedAt<0)
    throw recoveryFailure('Local recovery copy could not be verified.');
  assertRecoveryId(value.copyId);
  const entry=value as unknown as EditorRecoveryCopy;
  validateRecoveryPayload(entry.payload);
  if(entry.cloudBaseRevision!==entry.payload.cloudBaseRevision)
    throw recoveryFailure('Local recovery revision does not match its payload.');
  return entry;
}
function recoverySummary(entry:EditorRecoveryCopy):EditorRecoverySummary {
  return {copyId:entry.copyId,savedAt:entry.savedAt,cloudBaseRevision:entry.cloudBaseRevision,
    ...(entry.checkpointSequence===undefined?{}:{checkpointSequence:entry.checkpointSequence})};
}
function canonicalRecoveryPayload(payload:EditorRecoveryPayload):string {
  return JSON.stringify(payload,(_key,value:unknown)=>{
    return isPlainRecord(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value;
  });
}

/** Browser-local drafts are not cloud commits, durable backups or publication. */
export class IndexedDbEditorDraftStore {
  private readonly databaseName:string;
  private readonly factory:IDBFactory;
  constructor(databaseName='kadmeion-owner-drafts',factory:IDBFactory=globalThis.indexedDB) {
    if(!factory)throw new ContractError('VALIDATION','IndexedDB is unavailable on this device.');
    this.databaseName=databaseName;this.factory=factory;
  }

  private open():Promise<IDBDatabase> {
    return new Promise((resolve,reject)=>{
      const request=this.factory.open(this.databaseName,1);
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains('draft-heads'))
          request.result.createObjectStore('draft-heads');
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error??new Error('Local database unavailable.'));
      request.onblocked=()=>reject(new Error('Local database upgrade blocked by another tab.'));
    });
  }

  async load(ownerId:string,portfolioId:string):Promise<EditorHead|null> {
    const db=await this.open();
    try {
      return await new Promise((resolve,reject)=>{
        const request=db.transaction('draft-heads','readonly').objectStore('draft-heads').get(ownerId+':'+portfolioId);
        request.onsuccess=()=>{
          try {
            const value=request.result as EditorHead|undefined;
            if(value)validateSnapshot(value.snapshot);
            resolve(value??null);
          } catch(error) {
            reject(error);
          }
        };
        request.onerror=()=>reject(request.error??new Error('Local read failed.'));
      });
    }finally{db.close();}
  }

  async save(ownerId:string,portfolioId:string,head:EditorHead,expectedLocalRevision:number|null):Promise<void> {
    validateSnapshot(head.snapshot);
    if(!Number.isSafeInteger(head.revision)||head.revision<0)
      throw new ContractError('VALIDATION','Invalid local revision.');
    const db=await this.open();
    try {
      await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction('draft-heads','readwrite');
        const store=tx.objectStore('draft-heads');
        const key=ownerId+':'+portfolioId;
        const read=store.get(key);
        let alreadyRejected=false;
        read.onsuccess=()=>{
          const saved=read.result as EditorHead|undefined;
          const currentRevision=saved?.revision??null;
          if(currentRevision!==expectedLocalRevision){
            alreadyRejected=true;tx.abort();
            reject(new ContractError('REVISION_CONFLICT','Another tab saved a newer local draft.'));
            return;
          }
          store.put(structuredClone(head),key);
        };
        read.onerror=()=>reject(read.error??new Error('Local read failed.'));
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>{if(!alreadyRejected)reject(tx.error??new Error('Local save failed.'));};
        tx.onabort=()=>{if(!alreadyRejected)reject(tx.error??new Error('Local transaction aborted.'));};
      });
    }finally{db.close();}
  }


  /**
   * Separate versioned store avoids upgrading the older draft-heads database.
   * A device's IndexedDB is not an auth boundary: callers must pass only the
   * live-verified owner's scoped IDs and invalidate access on epoch changes.
   */
  private openRecovery():Promise<IDBDatabase> {
    return new Promise((resolve,reject)=>{
      const request=this.factory.open(this.databaseName+'-recovery-v1',1);
      let blocked=false;
      request.onupgradeneeded=()=>{
        const store=request.result.createObjectStore(RECOVERY_STORE,{keyPath:['ownerId','portfolioId','copyId']});
        store.createIndex(RECOVERY_INDEX,['ownerId','portfolioId']);
      };
      request.onsuccess=()=>{
        const db=request.result;
        if(blocked){db.close();return;}
        db.onversionchange=()=>db.close();
        resolve(db);
      };
      request.onerror=()=>reject(request.error??new Error('Local recovery database unavailable.'));
      request.onblocked=()=>{blocked=true;reject(new Error('Local recovery database is blocked by another tab.'));};
    });
  }

  private async recoveryTransaction<T>(mode:IDBTransactionMode,
    action:(store:IDBObjectStore,done:(value:T)=>void,fail:(error:unknown)=>void)=>void):Promise<T> {
    const db=await this.openRecovery();
    try {
      return await new Promise<T>((resolve,reject)=>{
        const tx=db.transaction(RECOVERY_STORE,mode);
        let completed=false,result:T;
        const done=(value:T)=>{result=value;completed=true;};
        const fail=(error:unknown)=>{
          reject(error);
          try{tx.abort();}catch{/* transaction already finished */}
        };
        tx.oncomplete=()=>completed?resolve(result):reject(new Error('Missing local recovery acknowledgement.'));
        tx.onerror=()=>reject(tx.error??new Error('Local recovery transaction failed.'));
        tx.onabort=()=>reject(tx.error??new Error('Local recovery transaction aborted.'));
        try{action(tx.objectStore(RECOVERY_STORE),done,fail);}catch(error){fail(error);}
      });
    }finally{db.close();}
  }

  /**
   * Keep Both primitive: append a separately named copy without replacing
   * another tab's draft or modifying a cloud revision. Identical copy-ID
   * replay is acknowledged; different content under that ID is rejected.
   * No automatic pruning, remote sync or execution of recovered source.
   */
  async saveRecoveryCopy(ownerId:string,portfolioId:string,copyId:string,
    payload:EditorRecoveryPayload):Promise<EditorRecoverySummary> {
    assertRecoveryId(ownerId);assertRecoveryId(portfolioId);assertRecoveryId(copyId);
    validateRecoveryPayload(payload);
    const immutable=structuredClone(payload);
    const entry:EditorRecoveryCopy={ownerId,portfolioId,copyId,savedAt:Date.now(),
      cloudBaseRevision:immutable.cloudBaseRevision,payload:immutable};
    return this.recoveryTransaction<EditorRecoverySummary>('readwrite',(store,done,fail)=>{
      const get=store.get([ownerId,portfolioId,copyId]);
      get.onsuccess=()=>{
        try {
          if(get.result!==undefined){
            const previous=validateStoredRecovery(get.result,ownerId,portfolioId,copyId);
            if(previous.checkpointSequence!==undefined||
               canonicalRecoveryPayload(previous.payload)!==canonicalRecoveryPayload(immutable))
              throw new ContractError('REVISION_CONFLICT','Recovery copy already exists with different edits. Choose a new copy ID.');
            done(recoverySummary(previous));return;
          }
          const count=store.index(RECOVERY_INDEX).count([ownerId,portfolioId]);
          count.onsuccess=()=>{
            try {
              if(count.result>=MAX_RECOVERY_COPIES)
                throw recoveryFailure('Recovery copy limit reached. Export or explicitly remove a copy before saving another.');
              const add=store.add(entry);
              add.onsuccess=()=>done(recoverySummary(entry));
            }catch(error){fail(error);}
          };
        }catch(error){fail(error);}
      };
    });
  }

  /**
   * Opt-in, per-mounted-editor working checkpoint. A fresh UUID is allocated
   * for each writer, never taken from browser auth or reused by a new tab.
   * Same sequence plus same bytes is an idempotent replay; a stale writer
   * cannot modify another copy. Explicit Keep Both copies remain immutable.
   * Uses the SAME per-portfolio bound as ordinary recovery copies; no pruning.
   */
  async writeRecoveryCheckpoint(ownerId:string,portfolioId:string,copyId:string,
    expectedSequence:number,payload:EditorRecoveryPayload):Promise<EditorRecoverySummary> {
    assertRecoveryId(ownerId);assertRecoveryId(portfolioId);assertRecoveryId(copyId);
    if(!Number.isSafeInteger(expectedSequence)||expectedSequence<0||expectedSequence>=Number.MAX_SAFE_INTEGER)
      throw recoveryFailure('Invalid checkpoint sequence.');
    validateRecoveryPayload(payload);
    const immutable=structuredClone(payload);
    const nextSequence=expectedSequence+1;
    const entry:EditorRecoveryCopy={ownerId,portfolioId,copyId,savedAt:Date.now(),
      cloudBaseRevision:immutable.cloudBaseRevision,checkpointSequence:nextSequence,payload:immutable};
    return this.recoveryTransaction<EditorRecoverySummary>('readwrite',(store,done,fail)=>{
      const read=store.get([ownerId,portfolioId,copyId]);
      read.onsuccess=()=>{
        try{
          if(read.result!==undefined){
            const previous=validateStoredRecovery(read.result,ownerId,portfolioId,copyId);
            if(previous.checkpointSequence===nextSequence&&
               canonicalRecoveryPayload(previous.payload)===canonicalRecoveryPayload(immutable)){
              done(recoverySummary(previous));return;
            }
            if(previous.checkpointSequence!==expectedSequence)
              throw new ContractError('REVISION_CONFLICT','Browser checkpoint changed or is an immutable copy. Preserve edits under a new copy.');
            const write=store.put(entry);
            write.onsuccess=()=>done(recoverySummary(entry));
            return;
          }
          if(expectedSequence!==0)
            throw new ContractError('REVISION_CONFLICT','Browser checkpoint was removed. Do not recreate it silently.');
          const count=store.index(RECOVERY_INDEX).count([ownerId,portfolioId]);
          count.onsuccess=()=>{
            try{
              if(count.result>=MAX_RECOVERY_COPIES)
                throw recoveryFailure('Recovery copy limit reached. Export or explicitly remove a copy.');
              const add=store.add(entry);
              add.onsuccess=()=>done(recoverySummary(entry));
            }catch(error){fail(error);}
          };
        }catch(error){fail(error);}
      };
    });
  }

  /** Promote an exact acknowledged working checkpoint into an immutable
   * recovery copy without consuming another slot in the bounded catalogue. */
  async freezeRecoveryCheckpoint(ownerId:string,portfolioId:string,copyId:string,
    expectedSequence:number,payload:EditorRecoveryPayload):Promise<EditorRecoverySummary>{
    assertRecoveryId(ownerId);assertRecoveryId(portfolioId);assertRecoveryId(copyId);
    if(!Number.isSafeInteger(expectedSequence)||expectedSequence<1)throw recoveryFailure('Invalid checkpoint sequence.');
    validateRecoveryPayload(payload);
    const expected=canonicalRecoveryPayload(payload);
    return this.recoveryTransaction<EditorRecoverySummary>('readwrite',(store,done,fail)=>{
      const read=store.get([ownerId,portfolioId,copyId]);
      read.onsuccess=()=>{
        try{
          if(read.result===undefined)throw new ContractError('REVISION_CONFLICT','Browser checkpoint no longer exists.');
          const previous=validateStoredRecovery(read.result,ownerId,portfolioId,copyId);
          if(canonicalRecoveryPayload(previous.payload)!==expected||
            (previous.checkpointSequence!==undefined&&previous.checkpointSequence!==expectedSequence))
            throw new ContractError('REVISION_CONFLICT','Browser checkpoint changed. Preserve the current working bytes separately.');
          if(previous.checkpointSequence===undefined){done(recoverySummary(previous));return;}
          const {checkpointSequence:_sequence,...immutable}=previous;
          const write=store.put(immutable);write.onsuccess=()=>done(recoverySummary(immutable));
        }catch(error){fail(error);}
      };
    });
  }

  async listRecoveryCopies(ownerId:string,portfolioId:string):Promise<EditorRecoverySummary[]> {
    assertRecoveryId(ownerId);assertRecoveryId(portfolioId);
    return this.recoveryTransaction<EditorRecoverySummary[]>('readonly',(store,done,fail)=>{
      const request=store.index(RECOVERY_INDEX).getAll([ownerId,portfolioId],MAX_RECOVERY_COPIES+1);
      request.onsuccess=()=>{
        try{
          if(request.result.length>MAX_RECOVERY_COPIES)throw recoveryFailure('Local recovery catalogue exceeds its limit.');
          done(request.result.map(raw=>recoverySummary(validateStoredRecovery(raw,ownerId,portfolioId)))
            .sort((a,b)=>b.savedAt-a.savedAt||a.copyId.localeCompare(b.copyId)));
        }catch(error){fail(error);}
      };
    });
  }

  async loadRecoveryCopy(ownerId:string,portfolioId:string,copyId:string):Promise<EditorRecoveryCopy|null> {
    assertRecoveryId(ownerId);assertRecoveryId(portfolioId);assertRecoveryId(copyId);
    return this.recoveryTransaction<EditorRecoveryCopy|null>('readonly',(store,done,fail)=>{
      const request=store.get([ownerId,portfolioId,copyId]);
      request.onsuccess=()=>{
        try{done(request.result===undefined?null:structuredClone(validateStoredRecovery(request.result,ownerId,portfolioId,copyId)));}
        catch(error){fail(error);}
      };
    });
  }

  /** Caller must obtain explicit owner consent; never delete on sync or read. */
  async removeRecoveryCopy(ownerId:string,portfolioId:string,copyId:string,
    expectedCheckpointSequence?:number):Promise<void> {
    assertRecoveryId(ownerId);assertRecoveryId(portfolioId);assertRecoveryId(copyId);
    return this.recoveryTransaction<void>('readwrite',(store,done,fail)=>{
      const key=[ownerId,portfolioId,copyId];
      const read=store.get(key);
      read.onsuccess=()=>{
        try{
          if(read.result===undefined){done(undefined);return;}
          const previous=validateStoredRecovery(read.result,ownerId,portfolioId,copyId);
          if(previous.checkpointSequence!==expectedCheckpointSequence)
            throw new ContractError('REVISION_CONFLICT','Browser checkpoint changed. Refresh the catalogue before removing it.');
          const request=store.delete(key);request.onsuccess=()=>done(undefined);
        }catch(error){fail(error);}
      };
    });
  }

}
