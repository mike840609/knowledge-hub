// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { decodeTaskArtifactBody, MAX_ARTIFACT_BYTES } from "@/modules/task-knowledge/domain/task-artifact";
import {
  CredentialInvalidError,
  RevisionConflictError,
  RevisionOutOfOrderError,
  TaskArtifactError,
} from "@/modules/task-knowledge/domain/task-errors";
import { DomainError } from "@/shared/domain/errors";
import { taskIngestService } from "@/server/composition";

/**
 * The export credential's own header: the site password (HTTP Basic) acts on
 * `Authorization`, and a custom header forces a CORS preflight, which every
 * other method below answers 405 (design §7). Exempt from both gates by
 * exact pathname; this route authenticates solely by the credential.
 */
const TOKEN_HEADER = "x-knowledge-hub-export-token";
const HEADERS = { "Cache-Control": "private, no-store" };

const STATUS: Record<string, number> = {
  MALFORMED_JSON: 400,
  CREDENTIAL_INVALID: 401,
  SCOPE_DENIED: 403,
  REVISION_CONFLICT: 409,
  REVISION_OUT_OF_ORDER: 409,
  TASK_ARCHIVED: 409,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_ARTIFACT: 422,
  UNSUPPORTED_SCHEMA_VERSION: 422,
  WORKSPACE_BUSY: 503,
  DATABASE_UNAVAILABLE: 503,
};

/** Counts the bytes actually read and stops past the limit; `Content-Length` is never trusted. */
async function readLimited(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ARTIFACT_BYTES) {
      await reader.cancel();
      throw new TaskArtifactError("PAYLOAD_TOO_LARGE", `body is larger than ${MAX_ARTIFACT_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function failure(error: unknown): Response {
  const status = error instanceof DomainError ? STATUS[error.code] : undefined;
  if (!status || !(error instanceof DomainError)) {
    // Only the class name: a driver message could echo the payload.
    console.error("Task ingest failed.", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, { status: 500, headers: HEADERS });
  }
  const latest = error instanceof RevisionConflictError || error instanceof RevisionOutOfOrderError ? { latestRevisionNo: error.latestRevisionNo } : {};
  return NextResponse.json({ error: { code: error.code, message: error.message, ...latest } }, { status, headers: HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const token = request.headers.get(TOKEN_HEADER);
    if (!token) throw new CredentialInvalidError();
    const body = decodeTaskArtifactBody(await readLimited(request));
    const result = await taskIngestService().ingest(token, body);
    return NextResponse.json(
      { taskResultId: result.taskResultId, revisionNo: result.revisionNo, bindingId: result.bindingId, url: `/w/${result.workspaceId}/tasks/${result.taskResultId}` },
      { status: result.state === "CREATED" ? 201 : 200, headers: HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}

function methodNotAllowed(): Response {
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, Allow: "POST" } });
}

export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
