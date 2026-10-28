import { evaluateWorkspaceCapabilities, requireWorkspaceRead } from "@/modules/workspaces/application/workspace-authorization";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import type { WorkspaceUnitOfWork } from "@/modules/workspaces/ports/unit-of-work";
import { DomainError } from "@/shared/domain/errors";
import type { PersonalStore } from "../ports/personal-store";
import { isUuid } from "@/shared/ids/uuidv7";
import { markdownTooLarge } from "@/lib/markdown-limits";

export class PersonalService {
  constructor(private readonly store: PersonalStore, private readonly queries: KnowledgeQueryService, private readonly uow: WorkspaceUnitOfWork) {}
  private async authorize(caller: CallerContext, workspaceId: string, key?: string) {
    await this.uow.run(async r => {
      requireWorkspaceRead(await evaluateWorkspaceCapabilities(r, caller, workspaceId));
      const workspace = await r.workspaces.findById(workspaceId);
      if (workspace?.personalOwnerUserId !== caller.identity.id) throw new DomainError("WORKSPACE_NOT_FOUND", "Personal workspace unavailable.");
    });
    if (key !== undefined && key !== "draft:new") {
      const [kind, id, extra] = key.split(":");
      if (extra !== undefined || !["draft", "favorite"].includes(kind) || !isUuid(id ?? "")) throw new DomainError("INVALID_REQUEST", "Invalid personal item.");
      const doc = await this.queries.getDocument(caller, id, { includeArchived: true });
      if (doc.workspaceId !== workspaceId) throw new DomainError("DOCUMENT_NOT_FOUND", "Document unavailable.");
      return doc;
    }
  }
  async list(caller: CallerContext, workspaceId: string) {
    await this.authorize(caller, workspaceId);
    const items = (await this.store.list(caller.identity.id, workspaceId)).filter(item => !item.key.startsWith("prefs:"));
    const located = await this.locate(caller, workspaceId, items.filter(item => item.key !== "draft:new").map(item => item.key.split(":")[1]));
    const result = [];
    for (const item of items) {
      if (item.key === "draft:new") { result.push(item); continue; }
      const sourceId = located.get(item.key.split(":")[1]);
      if (sourceId) result.push({ ...item, sourceId });
    }
    return result;
  }
  async listFavorites(caller: CallerContext, workspaceId: string) {
    await this.authorize(caller, workspaceId);
    const items = await this.store.listFavorites(caller.identity.id, workspaceId);
    const located = await this.locate(caller, workspaceId, items.map(item => item.key.slice("favorite:".length)));
    return items.flatMap(item => {
      const sourceId = located.get(item.key.slice("favorite:".length));
      return sourceId ? [{ key: item.key, sourceId }] : [];
    });
  }
  /** Document ID → source ID for the documents this caller can read in this workspace, archived included. */
  private async locate(caller: CallerContext, workspaceId: string, documentIds: string[]) {
    const sourceIds = new Map<string, string>();
    if (documentIds.length === 0) return sourceIds;
    for (const [id, where] of await this.queries.locateDocuments(caller, documentIds, { includeArchived: true })) {
      if (where.workspaceId === workspaceId) sourceIds.set(id, where.sourceId);
    }
    return sourceIds;
  }
  async get(caller: CallerContext, workspaceId: string, key: string) {
    await this.authorize(caller, workspaceId, key);
    return await this.store.get(caller.identity.id, workspaceId, key) ?? { key, value: null, version: 0, updatedAt: "" };
  }
  async put(caller: CallerContext, workspaceId: string, key: string, value: unknown, expected: unknown) {
    await this.authorize(caller, workspaceId, key);
    if (!Number.isSafeInteger(expected) || Number(expected) < 0) throw new DomainError("INVALID_REQUEST", "Provide an expected version.");
    let payload: Record<string, unknown> | null = null;
    if (value !== null) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_REQUEST", "Invalid personal item.");
      const v = value as Record<string, unknown>;
      if (key.startsWith("draft:")) {
        const title = v.title;
        const markdown = v.markdown;
        if (typeof title !== "string" || title.length > 512 || typeof markdown !== "string" || !(v.baseRevisionId === null || typeof v.baseRevisionId === "string" && isUuid(v.baseRevisionId))) throw new DomainError("INVALID_REQUEST", "Invalid draft.");
        if (markdownTooLarge(markdown)) throw new DomainError("DRAFT_TOO_LARGE", "Draft is too large to save.");
        payload = { title, markdown, baseRevisionId: v.baseRevisionId };
      } else {
        if (v.favorite !== true) throw new DomainError("INVALID_REQUEST", "Invalid favorite.");
        payload = { favorite: true };
      }
    }
    if (!await this.store.put(caller.identity.id, workspaceId, key, payload, Number(expected))) throw new DomainError("PERSONAL_ITEM_CONFLICT", "This item changed in another tab or device. Your changes have been kept locally.");
    return { key, value: payload, version: Number(expected) + 1 };
  }
}
