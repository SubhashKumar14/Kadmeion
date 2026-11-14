import { ContractError } from './project.ts';

export type SlotIntent = 'CLEAR_SLOT' | 'ASSIGN_COMPONENT' | 'SET_SLOT_CONTENT';
export interface EditorOperation {
  opId: string;
  portfolioId: string;
  baseRevision: number;
  intent: SlotIntent;
  target: { sectionId: string; slotId: string };
  payload?: Readonly<Record<string, unknown>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function validateEditorOperation(value: unknown): EditorOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('VALIDATION', 'Operation must be an object.');
  const op = value as Record<string, unknown>;
  const target = op.target as Record<string, unknown> | null;
  if (typeof op.opId !== 'string' || !UUID.test(op.opId) ||
      typeof op.portfolioId !== 'string' || !UUID.test(op.portfolioId) ||
      !Number.isSafeInteger(op.baseRevision) || (op.baseRevision as number) < 0 ||
      !['CLEAR_SLOT', 'ASSIGN_COMPONENT', 'SET_SLOT_CONTENT'].includes(op.intent as string) ||
      !target || typeof target !== 'object' ||
      typeof target.sectionId !== 'string' || !ID.test(target.sectionId) ||
      typeof target.slotId !== 'string' || !ID.test(target.slotId) ||
      (op.payload !== undefined && (!op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload)))) {
    throw new ContractError('VALIDATION', 'Invalid typed editor operation.');
  }
  if (op.intent === 'ASSIGN_COMPONENT' &&
      (!op.payload || typeof (op.payload as Record<string, unknown>).componentId !== 'string')) {
    throw new ContractError('VALIDATION', 'Component assignment needs a pinned componentId.');
  }
  return op as unknown as EditorOperation;
}

export function assertBaseRevision(baseRevision: number, committedRevision: number): void {
  if (!Number.isSafeInteger(baseRevision) || !Number.isSafeInteger(committedRevision) || baseRevision < 0 || committedRevision < 0) {
    throw new ContractError('VALIDATION', 'Invalid revision number.');
  }
  if (baseRevision !== committedRevision) {
    throw new ContractError('REVISION_CONFLICT', 'Draft changed elsewhere; compare before retrying.');
  }
}
