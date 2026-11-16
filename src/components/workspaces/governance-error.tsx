"use client";

import { requestWorkspaceAccessCheck } from "@/components/shell/use-workspace-authorization";
import { organizeFailure } from "@/components/knowledge/organize-messages";

export type GovernanceFailure = { code: string; message: string; field?: string };
export class GovernanceRequestError extends Error {
  /** `status`: the response's HTTP status, when there was a response. */
  constructor(public failure: GovernanceFailure, public status?: number) {
    super(failure.message);
  }
}
/**
 * A failure worth trying again on its own: no response (the network), or the server's or a proxy's
 * temporary trouble. A refusal (a conflict, access, a limit) answers the same way every time.
 */
export function transientSaveFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof GovernanceRequestError) || error.status === undefined) return false;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}
export async function governanceRequest<T>(
  url: string,
  method = "GET",
  body?: unknown,
  options?: { notifyMutation?: boolean; keepalive?: boolean },
): Promise<T> {
  const response = await fetch(url, {
    method,
    // A request that outlives the page: an autosave sent as the page goes (`document-autosave`).
    ...(options?.keepalive ? { keepalive: true } : {}),
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // 403/404 and most 409s can mean the caller's access or the workspace lifecycle
    // changed, so re-check access. A 409 REVISION_CONFLICT is purely a content
    // versioning clash from a concurrent edit — not an authorization change — so
    // re-checking there would needlessly flip `confirmed` off and could disable
    // Save if the refresh transiently fails.
    const code = data?.error?.code;
    requestWorkspaceAccessCheck(response.status, typeof code === "string" ? code : undefined);
    throw new GovernanceRequestError(
      data?.error ?? {
        code: "REQUEST_FAILED",
        message: "Unable to complete the request. Please try again.",
      },
      response.status,
    );
  }
  if (method !== "GET" && options?.notifyMutation !== false) window.dispatchEvent(new Event("kh:workspace-mutation"));
  return data as T;
}
export function governanceFailure(error: unknown): GovernanceFailure {
  return error instanceof GovernanceRequestError
    ? error.failure
    : { code: "REQUEST_FAILED", message: "Unable to connect. Please try again." };
}
/** The tree's own refusals have a sentence of their own (daily-driver spec §7.1); a form that files a document into a folder shows it too. */
const TREE_CODES: ReadonlySet<string> = new Set(["INVALID_PARENT", "FOLDER_NOT_EMPTY", "TREE_CYCLE", "CROSS_SOURCE_MOVE"]);

export function GovernanceError({ error }: { error: GovernanceFailure | null }) {
  if (!error) return null;
  const message =
    TREE_CODES.has(error.code)
      ? organizeFailure(error)
      : error.code === "NOT_FOUND"
      ? "This resource is not available."
      : error.code === "WORKSPACE_ARCHIVED"
        ? "This workspace is archived and read-only. Refresh to see its current state."
        : error.code === "INSUFFICIENT_WORKSPACE_CAPABILITY"
          ? "You no longer have permission to perform this action."
          : error.message;
  return (
    <p role="alert" className="mt-2 text-body text-kh-danger">
      {message}
    </p>
  );
}
