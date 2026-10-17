import type { KnowledgeRevision } from './revision';

export type RevisionHistory = {
  state: 'WORKING' | 'CHECKPOINT';
  activityId: string | null;
  windowStartedAt: Date | null;
  name: string | null;
  reason: string;
};
export type RevisionSaveMode = 'AUTOSAVE' | 'CHECKPOINT' | 'RESTORE';
const MINUTE = 60_000;
/** Checkpoint time is measured from the start of the window, never the last keystroke. */
export function planRevisionHistory(current: KnowledgeRevision, author: string, now: Date, id: string, mode?: RevisionSaveMode) {
  const gap = now.getTime() - current.createdAt.getTime();
  const authorChanged = author !== current.createdBy;
  const newActivity = authorChanged || gap >= 60 * MINUTE || mode === 'RESTORE';
  const activityId = newActivity ? id : current.history?.activityId ?? current.id;
  const reset = newActivity || gap >= 2 * MINUTE || !current.history?.windowStartedAt;
  const start = reset ? now : current.history!.windowStartedAt!;
  const checkpoint = mode !== 'AUTOSAVE' || now.getTime() - start.getTime() >= 10 * MINUTE;
  const history: RevisionHistory = {
    state: checkpoint ? 'CHECKPOINT' : 'WORKING', activityId,
    windowStartedAt: checkpoint ? now : start, name: null,
    reason: mode === 'RESTORE' ? 'RESTORE' : mode === 'AUTOSAVE' ? 'AUTOSAVE' : 'MANUAL',
  };
  const preserve = current.history?.state === 'WORKING' && (authorChanged || gap >= 2 * MINUTE || mode !== 'AUTOSAVE');
  return { history, preserve, preserveReason: authorChanged ? 'AUTHOR' : gap >= 2 * MINUTE ? 'IDLE' : 'MANUAL' };
}
