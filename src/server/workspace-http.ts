import { NextResponse } from "next/server";
import { applicationServices } from "./composition";
import { toWorkspaceErrorResponse } from "./http-error-response";
import { DomainError } from "@/shared/domain/errors";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
export type WorkspaceRouteContext = { params: Promise<{ workspaceId: string; userId?: string }> };
export async function workspaceHttp(work: (services: ReturnType<typeof applicationServices>, caller: CallerContext) => Promise<unknown>, status = 200) {
  try { const services = applicationServices(); const { caller } = await services.establishTrustedCaller(); return NextResponse.json(await work(services, caller), { status, headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { const mapped = toWorkspaceErrorResponse(error); return NextResponse.json(mapped.body, { status: mapped.status, headers: { "Cache-Control": "private, no-store" } }); }
}
export async function requestFields(request: Request, fields: readonly string[]): Promise<Record<string, string>> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new DomainError("INVALID_REQUEST", "Provide a valid JSON object."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DomainError("INVALID_REQUEST", "Provide a JSON object.");
  const record = body as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const field of fields) { if (typeof record[field] !== "string") throw new DomainError("INVALID_REQUEST", `Provide ${field} as a string.`); result[field] = record[field]; }
  return result;
}
