import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeQueryService } from "./knowledge-query-service";
import type { HubKnowledgeCommandService } from "./hub-knowledge-command-service";
import { canonicalizeJsonObject } from "../domain/content";
import { ValidationError } from "../domain/errors";
export async function restoreRevision(queries: KnowledgeQueryService, hub: HubKnowledgeCommandService, caller: CallerContext, input: { documentId: string; revisionNo: number; expectedCurrentRevisionId: string }) {
  if (!Number.isSafeInteger(input.revisionNo) || input.revisionNo < 1 || typeof input.expectedCurrentRevisionId !== "string") throw new ValidationError("Choose a revision and provide the current revision ID.");
  const historical = await queries.getRevision(caller, input.documentId, input.revisionNo);
  return hub.createRevision(caller, { documentId: input.documentId, expectedCurrentRevisionId: input.expectedCurrentRevisionId, title: historical.title, markdown: historical.markdown, metadata: canonicalizeJsonObject(historical.metadata) });
}
