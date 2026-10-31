import { NextResponse } from "next/server";
import { applicationServices } from "./composition";
import { teamWorkspacesEnabled } from "./config";
import { toWorkspaceErrorResponse } from "./http-error-response";
import { requireRouteId } from "./authoring-input";
import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuidv7";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { PublishOrigin } from "@/modules/sources/domain/publication";
import { PublicationAccessDeniedError } from "@/modules/sources/domain/publication-errors";
import { WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";

export type PublicationRouteContext = { params: Promise<{ publicationId: string }> };
export type WorkspacePublicationsRouteContext = { params: Promise<{ workspaceId: string }> };

export type PublicationPublishInput = {
  teamWorkspaceId: string;
  name: string;
  origin: PublishOrigin;
};

export type PublicationJoinInput = {
  folderNodeId: string;
  acknowledgeLowOverlap?: boolean;
};

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

/**
 * The publication HTTP edge: the trusted caller and the same error envelope as
 * every other workspace route, plus the publication command codes. Feature
 * checks (membership, capability, ownership, names, claims) stay in
 * `PublicationService`; this file only parses the body and maps outcomes.
 */
export async function publicationHttp(
  work: (
    services: ReturnType<typeof applicationServices>,
    caller: CallerContext,
  ) => Promise<unknown>,
  status = 200,
): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    // The whole publication surface is announced with Team workspaces; while
    // they are closed every route is indistinguishable from a missing one.
    if (!teamWorkspacesEnabled()) throw new WorkspaceNotFoundError();
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const result = await work(services, caller);
    if (result instanceof Response) {
      result.headers.set("Cache-Control", "private, no-store");
      return result;
    }
    if (status === 204) return new NextResponse(null, { status, headers });
    return NextResponse.json(result, { status, headers });
  } catch (error) {
    const mapped = toPublicationErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers });
  }
}

function toPublicationErrorResponse(error: unknown): { status: number; body: ErrorBody } {
  // A member lacking source.manage is a visible 403. A non-member never
  // reaches this class: the service answers with a not-found instead.
  if (error instanceof PublicationAccessDeniedError) {
    return {
      status: 403,
      body: { error: { code: "INSUFFICIENT_WORKSPACE_CAPABILITY", message: error.message } },
    };
  }
  if (error instanceof DomainError) {
    if (error.code === "NOT_FOUND") {
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "The requested resource was not found." } } };
    }
    if (error.code === "PUBLICATION_NAME_TAKEN") {
      return { status: 400, body: { error: { code: error.code, message: error.message } } };
    }
    if (error.code === "PUBLICATION_ORIGINAL_TAKEN" || error.code === "PUBLICATION_JOIN_LOW_OVERLAP") {
      return { status: 409, body: publicationBody(error) };
    }
  }
  return toWorkspaceErrorResponse(error);
}

function publicationBody(error: { code: string; message: string; details?: Record<string, unknown> }): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

function invalid(message: string): never {
  throw new DomainError("INVALID_REQUEST", message);
}

function recordOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Provide a JSON object.");
  return body as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") invalid(`Provide ${field} as a string.`);
  return value;
}

function requiredUuid(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!isUuid(value)) invalid(`Provide ${field} as an ID.`);
  return value;
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    invalid("Provide a valid JSON object.");
  }
}

export async function parsePublicationPublishInput(request: Request): Promise<PublicationPublishInput> {
  const record = recordOf(await readBody(request));
  const teamWorkspaceId = requiredUuid(record, "teamWorkspaceId");
  const name = requiredString(record, "name");
  const origin = record.origin;
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) {
    invalid("Provide origin as an object.");
  }
  const originRecord = origin as Record<string, unknown>;
  if (originRecord.kind === "FOLDER") {
    return { teamWorkspaceId, name, origin: { kind: "FOLDER", folderNodeId: requiredUuid(originRecord, "folderNodeId") } };
  }
  if (originRecord.kind === "DOCUMENT") {
    return { teamWorkspaceId, name, origin: { kind: "DOCUMENT", documentId: requiredUuid(originRecord, "documentId") } };
  }
  invalid('Provide origin.kind as "FOLDER" or "DOCUMENT".');
}

export async function parsePublicationJoinInput(request: Request): Promise<PublicationJoinInput> {
  const record = recordOf(await readBody(request));
  const folderNodeId = requiredUuid(record, "folderNodeId");
  const acknowledgeLowOverlap = record.acknowledgeLowOverlap;
  if (acknowledgeLowOverlap !== undefined && typeof acknowledgeLowOverlap !== "boolean") {
    invalid("Provide acknowledgeLowOverlap as a boolean.");
  }
  return {
    folderNodeId,
    ...(acknowledgeLowOverlap === undefined ? {} : { acknowledgeLowOverlap }),
  };
}

export async function parsePublicationRenameInput(request: Request): Promise<{ name: string }> {
  const record = recordOf(await readBody(request));
  return { name: requiredString(record, "name") };
}

export function publicationIdOf(context: PublicationRouteContext): Promise<string> {
  return context.params.then(({ publicationId }) => requireRouteId(publicationId, "the publication"));
}

export function workspaceIdOf(context: WorkspacePublicationsRouteContext): Promise<string> {
  return context.params.then(({ workspaceId }) => requireRouteId(workspaceId, "the workspace"));
}
