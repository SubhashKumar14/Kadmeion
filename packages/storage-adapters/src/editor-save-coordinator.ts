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
  | { status: 'LOCAL_FAILED'; reason: string };

export class EditorSaveCoordinator {
  constructor(
    private readonly local: Pick<IndexedDbEditorDraftStore, 'save'>,
    private readonly cloud: Pick<SupabasePortfolioRevisionStore, 'commit'>
  ) {}

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
    } catch {
      return { status: 'LOCAL_FAILED', reason: 'Local storage did not commit; preserve the editor buffer.' };
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
    return this.commitCloud(portfolioId, operationId, head);
  }
}
