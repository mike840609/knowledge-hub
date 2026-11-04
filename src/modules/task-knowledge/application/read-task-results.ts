import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuid";
import { parseTaskContent, type TaskContentV1 } from "../domain/task-artifact";
import type { TaskReferenceInput } from "../domain/task-references";
import type { ExportBindingStatus, ReferenceResolution, TaskLifecycle, TaskScope } from "../ports/task-export-store";
import type { TaskKnowledgeRepositories, TaskKnowledgeUnitOfWork } from "../ports/unit-of-work";
import { readTaskReferenceAvailability } from "./internal/resolve-task-references";
import { assertOwnedPersonal } from "./manage-export-binding";

export const TASK_LIST_PAGE_SIZE = 50;

export const taskResultNotFound = () => new DomainError("TASK_RESULT_NOT_FOUND", "Task result not found.");

export type TaskContent = TaskContentV1;

export type TaskListItem = {
  taskResultId: string;
  title: string;
  agent: string;
  completedAt: string;
  verificationStatus: string;
  lifecycle: TaskLifecycle;
  latestRevisionNo: number;
  bindingLabel: string;
  bindingStatus: ExportBindingStatus;
};

/** A WIKI reference's state now; `document` is set only while the viewer may open it. External references carry no state. */
export type TaskReferenceView = {
  reference: TaskReferenceInput;
  state: ReferenceResolution | null;
  document: { documentId: string; sourceId: string; title: string | null } | null;
};

export type TaskResultDetail = {
  taskResultId: string;
  lifecycle: TaskLifecycle;
  archivedAt: Date | null;
  latestRevisionNo: number;
  revisionNo: number;
  revisionHistory: { revisionNo: number; createdAt: Date }[];
  binding: { label: string; status: ExportBindingStatus };
  content: TaskContent;
  references: TaskReferenceView[];
};

/** The stored artifact minus the CLI-owned identity fields, held to the content contract again. */
function content(artifactJson: string): TaskContent {
  const raw = JSON.parse(artifactJson) as Record<string, unknown>;
  for (const key of ["schemaVersion", "taskId", "artifactRevision"]) delete raw[key];
  return parseTaskContent(raw);
}

/** Owner-only reads of Task Results in their own ACTIVE My Space; a credential alone never reads. */
export class TaskResultReadService {
  constructor(private readonly unitOfWork: TaskKnowledgeUnitOfWork) {}

  async list(caller: CallerContext, workspaceId: string, query: { lifecycle?: TaskLifecycle; cursor?: string | null }): Promise<{ items: TaskListItem[]; nextCursor: string | null }> {
    if (!isUuid(workspaceId)) throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.");
    const beforeId = query.cursor && isUuid(query.cursor) ? query.cursor : null;
    return this.unitOfWork.run(async (r) => {
      assertOwnedPersonal(caller, await r.workspaces.lockSharedById(workspaceId));
      const rows = await r.taskExports.listTasks(workspaceId, { lifecycle: query.lifecycle ?? "ACTIVE", beforeId, limit: TASK_LIST_PAGE_SIZE + 1 });
      const items = rows.slice(0, TASK_LIST_PAGE_SIZE).map(({ task, bindingLabel, bindingStatus, artifactJson }) => {
        const { title, agent, completedAt, verification } = content(artifactJson);
        return {
          taskResultId: task.id, title, agent, completedAt, verificationStatus: verification.status,
          lifecycle: task.lifecycle, latestRevisionNo: task.latestRevisionNo, bindingLabel, bindingStatus,
        };
      });
      return { items, nextCursor: rows.length > TASK_LIST_PAGE_SIZE ? items[items.length - 1].taskResultId : null };
    });
  }

  async get(caller: CallerContext, workspaceId: string, taskResultId: string, options: { revisionNo?: number } = {}): Promise<TaskResultDetail> {
    if (!isUuid(workspaceId)) throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.");
    return this.unitOfWork.run(async (r) => {
      const scope = await ownedTaskScope(r, caller, workspaceId, taskResultId);
      const { task, binding } = scope;
      const revisionNo = options.revisionNo ?? task.latestRevisionNo;
      const revision = await r.taskExports.getRevision(task.id, revisionNo);
      if (!revision) throw taskResultNotFound();
      const stored = await r.taskExports.listReferences(task.id, revisionNo);
      const references: TaskReferenceView[] = [];
      for (const item of stored) {
        if (item.resolution === null) { references.push({ reference: item.reference, state: null, document: null }); continue; }
        const available = await readTaskReferenceAvailability(r, caller, { workspaceId, reference: item });
        const document = available === "RESOLVED" && item.resolvedDocumentId ? await r.documents.getState(item.resolvedDocumentId) : null;
        references.push({
          reference: item.reference,
          state: item.resolution === "RESOLVED" ? available : item.resolution,
          document: document ? { documentId: document.documentId, sourceId: document.sourceId, title: document.title } : null,
        });
      }
      return {
        taskResultId: task.id, lifecycle: task.lifecycle, archivedAt: task.archivedAt, latestRevisionNo: task.latestRevisionNo, revisionNo,
        revisionHistory: await r.taskExports.listRevisions(task.id),
        binding: { label: binding.label, status: binding.status },
        content: content(revision.artifactJson),
        references,
      };
    });
  }
}

/** The caller's own ACTIVE My Space, and a task whose binding's Source lies in it; anything else is not found. */
export async function ownedTaskScope(r: TaskKnowledgeRepositories, caller: CallerContext, workspaceId: string, taskResultId: string): Promise<TaskScope> {
  assertOwnedPersonal(caller, await r.workspaces.lockSharedById(workspaceId));
  const scope = isUuid(taskResultId) ? await r.taskExports.getTaskScope(taskResultId) : null;
  if (!scope || scope.binding.workspaceId !== workspaceId || scope.binding.ownerUserId !== caller.identity.id) throw taskResultNotFound();
  return scope;
}
