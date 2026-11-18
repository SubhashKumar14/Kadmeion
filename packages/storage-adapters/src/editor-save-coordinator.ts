import type { EditorHead } from '../../editor-core/src/index.ts';
import { validateSnapshot } from '../../editor-core/src/index.ts';
import type { CloudCommitReceipt, SupabasePortfolioRevisionStore } from './supabase-portfolio-revisions.ts';
import type { IndexedDbEditorDraftStore } from './indexeddb-editor-drafts.ts';

/**
 * Local acknowledgement precedes cloud acknowledgement.
 * Never report CLOUD_SAVED on an optimistic UI write or a failed provider request.
 */
export type EditorSaveResult =
  | { status: 'CLOUD_SAVED'; localRevision: number; cloud: CloudCommitReceipt }
  | { status: 'LOCAL_ONLY'; localRevision: number; reason: string }
  | { status: 'CLOUD_CONFLICT'; localRevision: number; reason: string }
  | { status: 'LOCAL_CONFLICT'; reason: string }
  | { status: 'LOCAL_FAILED'; reason: string };

export class EditorSaveCoordinator {
  private readonly local: Pick<IndexedDbEditorDraftStore, 'save'>;
  private readonly cloud: Pick<SupabasePortfolioRevisionStore, 'commit'>;
  // An identical cloud retry is permitted only after THIS coordinator observed
  // a successful local commit. The map is deliberately volatile: reopening a
  // browser must re-read and reconcile IndexedDB before any remote retry.
  private readonly locallyAcknowledged = new Map<string,{revision:number;snapshot:string}>();
  private static readonly MAX_PENDING_ACKS = 32;
  constructor(
    local: Pick<IndexedDbEditorDraftStore, 'save'>,
    cloud: Pick<SupabasePortfolioRevisionStore, 'commit'>
  ) {
    this.local=local;
    this.cloud=cloud;
  }

  private async commitCloud(
    portfolioId: string,
    operationId: string,
    head: EditorHead
  ): Promise<Exclude<EditorSaveResult, { status: 'LOCAL_FAILED' }>> {
    try {
      const receipt = await this.cloud.commit(portfolioId, operationId, head.revision - 1, head.snapshot);
      if (receipt.portfolioId !== portfolioId || receipt.revision !== head.revision) {
        return { status: 'LOCAL_ONLY', localRevision: head.revision, reason: 'Cloud revision did not match the local head.' };
      }
      return { status: 'CLOUD_SAVED', localRevision: head.revision, cloud: receipt };
    } catch (cause) {
      const error = cause as { code?: string; message?: string } | null;
      if (error?.code === 'REVISION_CONFLICT') {
        return { status: 'CLOUD_CONFLICT', localRevision: head.revision, reason: 'Cloud head changed; compare and recover manually.' };
      }
      return { status: 'LOCAL_ONLY', localRevision: head.revision, reason: 'Cloud persistence was not acknowledged; retain your local draft.' };
    }
  }

  async save(
    ownerId: string, portfolioId: string, operationId: string,
    head: EditorHead, expectedLocalRevision: number | null
  ): Promise<EditorSaveResult> {
    validateSnapshot(head.snapshot);
    if (!Number.isSafeInteger(head.revision) || head.revision < 1) {
      return { status: 'LOCAL_FAILED', reason: 'Cannot commit an unsaved initial revision.' };
    }
    try {
      await this.local.save(ownerId, portfolioId, head, expectedLocalRevision);
    } catch (cause) {
      if ((cause as {code?:string}|null)?.code === 'REVISION_CONFLICT') {
        return {status:'LOCAL_CONFLICT',reason:'Another local editor revision was saved. Compare before retrying; your buffer remains uncommitted.'};
      }
      return { status: 'LOCAL_FAILED', reason: 'Local storage did not commit; preserve the editor buffer.' };
    }
    const key=JSON.stringify([portfolioId, operationId]);
    this.locallyAcknowledged.delete(key);
    this.locallyAcknowledged.set(key,{
      revision:head.revision,snapshot:JSON.stringify(head.snapshot)
    });
    if(this.locallyAcknowledged.size>EditorSaveCoordinator.MAX_PENDING_ACKS){
      const oldest=this.locallyAcknowledged.keys().next().value;
      if(oldest!==undefined)this.locallyAcknowledged.delete(oldest);
    }
    return this.commitCloud(portfolioId, operationId, head);
  }

  /**
   * Retry the identical remote operation without re-saving the local revision.
   * Never auto-merge conflicting remote heads.
   */
  async retryCloud(portfolioId: string, operationId: string, head: EditorHead):
    Promise<Exclude<EditorSaveResult, { status: 'LOCAL_FAILED' }>> {
    validateSnapshot(head.snapshot);
    if (!Number.isSafeInteger(head.revision) || head.revision < 1) {
      return { status: 'LOCAL_ONLY', localRevision: head.revision, reason: 'No committed local revision exists.' };
    }
    const acknowledgement=this.locallyAcknowledged.get(JSON.stringify([portfolioId,operationId]));
    if(!acknowledgement||acknowledgement.revision!==head.revision||
       acknowledgement.snapshot!==JSON.stringify(head.snapshot)){
      return {status:'LOCAL_ONLY',localRevision:head.revision,
        reason:'No matching locally acknowledged revision is available for this retry. Reload and reconcile the private draft before attempting cloud sync.'};
    }
    return this.commitCloud(portfolioId, operationId, head);
  }
}
