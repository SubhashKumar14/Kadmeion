import { ContractError } from '../../contracts/src/project.ts';
import { validateSnapshot, type EditorHead } from '../../editor-core/src/index.ts';

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
}
