import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuid";
import type { TaskLifecycle } from "../ports/task-export-store";
import type { TaskKnowledgeUnitOfWork } from "../ports/unit-of-work";
import { ownedTaskScope, taskResultNotFound } from "./read-task-results";

/** Owner-only archive and restore. Lock order: Workspace shared, then the task FOR UPDATE (as ingest takes it). */
export class TaskLifecycleService {
  constructor(private readonly unitOfWork: TaskKnowledgeUnitOfWork) {}

  archive(caller: CallerContext, workspaceId: string, taskResultId: string): Promise<void> {
    return this.set(caller, workspaceId, taskResultId, "ARCHIVED");
  }

  restore(caller: CallerContext, workspaceId: string, taskResultId: string): Promise<void> {
    return this.set(caller, workspaceId, taskResultId, "ACTIVE");
  }

  private async set(caller: CallerContext, workspaceId: string, taskResultId: string, lifecycle: TaskLifecycle): Promise<void> {
    if (!isUuid(workspaceId)) throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.");
    await this.unitOfWork.run(async (r) => {
      await ownedTaskScope(r, caller, workspaceId, taskResultId);
      const task = await r.taskExports.lockTaskForUpdate(taskResultId);
      if (!task) throw taskResultNotFound();
      if (task.lifecycle !== lifecycle) await r.taskExports.setTaskLifecycle(task.id, lifecycle, caller.identity.id);
    });
  }
}
