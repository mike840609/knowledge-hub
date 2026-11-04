import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuid";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { hashExportToken, issueExportToken } from "../domain/export-credential";
import type { TaskWorkspaceState } from "../ports/lookups";
import type { ExportBindingSummary } from "../ports/task-export-store";
import type { TaskKnowledgeRepositories, TaskKnowledgeUnitOfWork } from "../ports/unit-of-work";

export const MAX_BINDING_LABEL_LENGTH = 200;

const workspaceNotFound = () => new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.");
const bindingNotFound = () => new DomainError("TASK_EXPORT_BINDING_NOT_FOUND", "Export binding not found.");

/** A binding lives only in the caller's own ACTIVE My Space. */
function assertOwnedPersonal(caller: CallerContext, workspace: TaskWorkspaceState | null, options: { allowArchived?: boolean } = {}) {
  if (!workspace || workspace.kind !== "PERSONAL" || workspace.ownerUserId !== caller.identity.id) throw workspaceNotFound();
  if (caller.personalWorkspaceOnly !== undefined && caller.personalWorkspaceOnly !== workspace.workspaceId) throw workspaceNotFound();
  if (workspace.status !== "ACTIVE" && !options.allowArchived) throw new DomainError("WORKSPACE_ARCHIVED", "This workspace is archived.");
}

function label(raw: string): string {
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_BINDING_LABEL_LENGTH) {
    throw new DomainError("INVALID_REQUEST", `Provide a label of 1-${MAX_BINDING_LABEL_LENGTH} characters.`);
  }
  return value;
}

export type BindingRef = { workspaceId: string; bindingId: string };

/**
 * Browser-authenticated management of export bindings (design §6). Every
 * writer holds the Workspace in share mode and never FOR UPDATE.
 */
export class ManageExportBindingService {
  constructor(private readonly unitOfWork: TaskKnowledgeUnitOfWork) {}

  async create(caller: CallerContext, input: { workspaceId: string; sourceId: string; label: string }): Promise<{ bindingId: string; token: string }> {
    const bindingLabel = label(input.label);
    if (!isUuid(input.workspaceId)) throw workspaceNotFound();
    if (!isUuid(input.sourceId)) throw new DomainError("SOURCE_NOT_FOUND", "Source not found.");
    const bindingId = uuidv7();
    const token = issueExportToken();
    await this.unitOfWork.run(async (r) => {
      // Source before Workspace keeps the global lock order (Snapshot → Source → Workspace).
      const source = await r.sources.lockSharedById(input.sourceId);
      if (!source || source.workspaceId !== input.workspaceId) throw new DomainError("SOURCE_NOT_FOUND", "Source not found.");
      assertOwnedPersonal(caller, await r.workspaces.lockSharedById(input.workspaceId));
      if (source.sourceType !== "FOLDER_SYNC" || source.status !== "ACTIVE") {
        throw new DomainError("TASK_EXPORT_SOURCE_INELIGIBLE", "Choose an active synced folder Source.");
      }
      await r.taskExports.insertBinding({ id: bindingId, ownerUserId: caller.identity.id, sourceId: source.sourceId, label: bindingLabel });
      await r.taskExports.insertCredential({ id: uuidv7(), bindingId, tokenHash: hashExportToken(token) });
    });
    return { bindingId, token };
  }

  async list(caller: CallerContext, workspaceId: string): Promise<ExportBindingSummary[]> {
    if (!isUuid(workspaceId)) throw workspaceNotFound();
    return this.unitOfWork.run(async (r) => {
      assertOwnedPersonal(caller, await r.workspaces.lockSharedById(workspaceId), { allowArchived: true });
      return r.taskExports.listBindings(caller.identity.id, workspaceId);
    });
  }

  async revoke(caller: CallerContext, ref: BindingRef): Promise<void> {
    await this.lockOwnedBinding(caller, ref, { allowArchived: true }, async (r, status) => {
      if (status === "REVOKED") return;
      await r.taskExports.revokeBinding(ref.bindingId);
      await r.taskExports.revokeCredentialsForBinding(ref.bindingId);
    });
  }

  async rotate(caller: CallerContext, ref: BindingRef): Promise<{ token: string }> {
    const token = issueExportToken();
    await this.lockOwnedBinding(caller, ref, {}, async (r, status) => {
      if (status === "REVOKED") throw new DomainError("BINDING_REVOKED", "This binding was revoked; create a new one.");
      await r.taskExports.rotateCredential(ref.bindingId, { id: uuidv7(), tokenHash: hashExportToken(token) });
    });
    return { token };
  }

  /** Workspace shared, then the binding FOR UPDATE, re-read under the lock (design §6). */
  private async lockOwnedBinding(
    caller: CallerContext,
    ref: BindingRef,
    options: { allowArchived?: boolean },
    work: (r: TaskKnowledgeRepositories, status: "ACTIVE" | "REVOKED") => Promise<void>,
  ): Promise<void> {
    if (!isUuid(ref.workspaceId) || !isUuid(ref.bindingId)) throw bindingNotFound();
    await this.unitOfWork.run(async (r) => {
      const binding = await r.taskExports.getBinding(ref.bindingId);
      const source = binding ? await r.sources.getById(binding.sourceId) : null;
      if (!binding || !source || binding.ownerUserId !== caller.identity.id || source.workspaceId !== ref.workspaceId) throw bindingNotFound();
      try {
        assertOwnedPersonal(caller, await r.workspaces.lockSharedById(source.workspaceId), options);
      } catch (error) {
        if (error instanceof DomainError && error.code === "WORKSPACE_NOT_FOUND") throw bindingNotFound();
        throw error;
      }
      const locked = await r.taskExports.lockBindingForUpdate(ref.bindingId);
      if (!locked) throw bindingNotFound();
      await work(r, locked.status);
    });
  }
}
