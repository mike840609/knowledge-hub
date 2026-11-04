import { uuidv7 } from "@/shared/ids/uuidv7";
import { hashExportToken } from "../domain/export-credential";
import { canonicalTaskHash, canonicalTaskJson, parseTaskArtifact, type TaskArtifactV1 } from "../domain/task-artifact";
import {
  CredentialInvalidError,
  RevisionConflictError,
  RevisionOutOfOrderError,
  ScopeDeniedError,
  TaskArchivedError,
} from "../domain/task-errors";
import type { StoredTaskReference } from "../ports/task-export-store";
import type { TaskKnowledgeRepositories, TaskKnowledgeUnitOfWork } from "../ports/unit-of-work";

export type IngestResult = {
  state: "CREATED" | "EXISTING";
  taskResultId: string;
  revisionNo: number;
  bindingId: string;
  workspaceId: string;
};

/** Until exact resolution runs, a WIKI reference is stored UNRESOLVED; external ones carry no resolution. */
function unresolved(artifact: TaskArtifactV1): StoredTaskReference[] {
  return (artifact.references ?? []).map((reference, ordinal) => ({
    ordinal,
    reference,
    resolution: reference.type === "WIKI" ? "UNRESOLVED" : null,
    resolvedDocumentId: null,
  }));
}

/**
 * The one task-knowledge write without a CallerContext (design §3, deviation
 * 2): its authority is the export credential, which names one binding and
 * permits only `task-result:create`. Reached only from the ingest route.
 */
export class IngestTaskResultService {
  constructor(private readonly unitOfWork: TaskKnowledgeUnitOfWork) {}

  async ingest(rawToken: string, rawBody: unknown): Promise<IngestResult> {
    const artifact = parseTaskArtifact(rawBody);
    if (typeof rawToken !== "string" || rawToken.length === 0) throw new CredentialInvalidError();
    const tokenHash = hashExportToken(rawToken);
    const artifactJson = canonicalTaskJson(artifact);
    const contentHash = canonicalTaskHash(artifact);
    return this.unitOfWork.run(async (r) => {
      const { bindingId, workspaceId } = await this.authorize(r, tokenHash);
      return this.store(r, { bindingId, workspaceId, artifact, artifactJson, contentHash });
    });
  }

  /** Lock order (design §6): unlocked reads, Workspace shared, then the binding shared with a re-read under it. */
  private async authorize(r: TaskKnowledgeRepositories, tokenHash: Uint8Array) {
    const credential = await r.taskExports.findCredentialByHash(tokenHash);
    if (!credential || credential.status !== "ACTIVE") throw new CredentialInvalidError();
    const binding = await r.taskExports.getBinding(credential.bindingId);
    if (!binding || binding.status !== "ACTIVE") throw new CredentialInvalidError();
    const source = await r.sources.getById(binding.sourceId);
    if (!source) throw new ScopeDeniedError();
    const workspace = await r.workspaces.lockSharedById(source.workspaceId);
    if (!workspace || workspace.kind !== "PERSONAL" || workspace.status !== "ACTIVE" || workspace.ownerUserId !== binding.ownerUserId) throw new ScopeDeniedError();
    if (source.sourceType !== "FOLDER_SYNC" || source.status !== "ACTIVE") throw new ScopeDeniedError();
    const locked = await r.taskExports.lockBindingShared(binding.id);
    const current = await r.taskExports.findCredentialByHash(tokenHash);
    if (locked?.status !== "ACTIVE" || current?.status !== "ACTIVE" || current.bindingId !== binding.id) throw new CredentialInvalidError();
    if (locked.ownerUserId !== workspace.ownerUserId) throw new ScopeDeniedError();
    return { bindingId: binding.id, workspaceId: source.workspaceId };
  }

  /** The six ordered rules, decided from the locked task row only. */
  private async store(
    r: TaskKnowledgeRepositories,
    input: { bindingId: string; workspaceId: string; artifact: TaskArtifactV1; artifactJson: string; contentHash: string },
  ): Promise<IngestResult> {
    const { artifact, bindingId } = input;
    const revisionNo = artifact.artifactRevision;
    const taskRowId = revisionNo === 1
      ? await r.taskExports.insertTaskIfAbsent({ id: uuidv7(), bindingId, taskId: artifact.taskId })
      : (await r.taskExports.findTask(bindingId, artifact.taskId))?.id;
    const task = taskRowId ? await r.taskExports.lockTaskForUpdate(taskRowId) : null;
    if (!task) throw new RevisionOutOfOrderError(0);
    const answer = (state: IngestResult["state"]): IngestResult => ({ state, taskResultId: task.id, revisionNo, bindingId, workspaceId: input.workspaceId });
    const stored = await r.taskExports.getRevision(task.id, revisionNo);
    if (stored) {
      if (stored.contentHash === input.contentHash) return answer("EXISTING");
      throw new RevisionConflictError(task.latestRevisionNo);
    }
    if (task.lifecycle === "ARCHIVED") throw new TaskArchivedError();
    if (revisionNo !== task.latestRevisionNo + 1) throw new RevisionOutOfOrderError(task.latestRevisionNo);
    await r.taskExports.insertRevision({ id: uuidv7(), taskResultId: task.id, revisionNo, artifactJson: input.artifactJson, contentHash: input.contentHash });
    await r.taskExports.insertReferences(task.id, revisionNo, unresolved(artifact));
    await r.taskExports.advanceLatestRevision(task.id, revisionNo);
    return answer("CREATED");
  }
}
