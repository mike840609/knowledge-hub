import { NextResponse } from "next/server";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { SearchScope } from "@/modules/knowledge/application/knowledge-search-service";
import { ContextTooLargeError } from "@/modules/knowledge/domain/agent-context";
import { ValidationError } from "@/modules/knowledge/domain/errors";
import {
  AgentDocumentAmbiguousError,
  CredentialInvalidError,
} from "@/modules/task-knowledge/domain/task-errors";
import { DomainError } from "@/shared/domain/errors";
import { agentReadServices } from "./composition";

/**
 * Agent read access design §4. Three read-only routes take the export
 * credential in its own header, exactly as ingest does: the site password acts
 * on `Authorization`, and a custom header forces a CORS preflight, which
 * every method but `GET` answers 405, HEAD and OPTIONS included.
 */
export const AGENT_TOKEN_HEADER = "x-knowledge-hub-export-token";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** The four "not yours or not there" answers share one status and one message. */
const NOT_FOUND = new Set(["DOCUMENT_NOT_FOUND", "TASK_RESULT_NOT_FOUND", "WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED"]);

const STATUS: Record<string, number> = {
  CREDENTIAL_INVALID: 401,
  SCOPE_DENIED: 403,
  TASK_SEARCH_UNAVAILABLE: 503,
  DATABASE_UNAVAILABLE: 503,
  WORKSPACE_BUSY: 503,
  SEARCH_TIMEOUT: 503,
};

/**
 * The credential's scope, with the binding's Workspace under a name route files
 * may carry: no file under `src/app/api/agent/` spells a Workspace ID, so the
 * value can only ever come from `authorize` (design §4;
 * `tests/unit/agent-read-no-workspace-id.test.ts`).
 */
export async function agentScope(
  services: ReturnType<typeof agentReadServices>,
  token: string,
  ref?: string,
): Promise<{ caller: CallerContext; space: string; documentId: string | null }> {
  const { caller, workspaceId, documentId } = await services.access.authorize(token, ref);
  return { caller, space: workspaceId, documentId };
}

/** A search scope pinned to the binding's My Space, never to a request value. */
export function spaceScope(space: string): SearchScope {
  return { kind: "workspace", workspaceId: space };
}

function failure(error: unknown): Response {
  if (error instanceof ContextTooLargeError) {
    return NextResponse.json({ error: { code: "CONTENT_TOO_LARGE", message: error.message } }, { status: 413, headers: NO_STORE });
  }
  if (error instanceof AgentDocumentAmbiguousError) {
    return NextResponse.json(
      { error: { code: "AMBIGUOUS", message: error.message, candidateDocumentIds: [...error.candidateDocumentIds] } },
      { status: 409, headers: NO_STORE },
    );
  }
  if (error instanceof DomainError) {
    if (NOT_FOUND.has(error.code)) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404, headers: NO_STORE });
    }
    const status = STATUS[error.code];
    if (status !== undefined) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status, headers: NO_STORE });
    }
    // The task search parser's own rejection is a caller-correctable input too.
    if (error instanceof ValidationError || error.code === "INVALID_TASK_SEARCH") {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 422, headers: NO_STORE });
    }
  }
  // Only the class name: a driver message could echo the query or the token.
  console.error("Agent read request failed.", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, { status: 500, headers: NO_STORE });
}

/**
 * Runs one credential-authenticated read. A missing header answers 401 before
 * any service exists, and every answer — success or failure — is private and
 * never stored.
 */
export async function agentReadHttp(
  request: Request,
  work: (services: ReturnType<typeof agentReadServices>, token: string) => Promise<unknown>,
): Promise<Response> {
  try {
    const token = request.headers.get(AGENT_TOKEN_HEADER);
    if (!token) throw new CredentialInvalidError();
    const result = await work(agentReadServices(), token);
    return NextResponse.json(result, { status: 200, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export const methodNotAllowed = (): Response =>
  new NextResponse(null, { status: 405, headers: { ...NO_STORE, Allow: "GET" } });
