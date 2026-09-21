"use client";

import { requestWorkspaceAccessCheck } from "@/components/shell/use-workspace-authorization";

export type GovernanceFailure = { code: string; message: string; field?: string };
export class GovernanceRequestError extends Error {
  constructor(public failure: GovernanceFailure) {
    super(failure.message);
  }
}
export async function governanceRequest<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
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
    );
  }
  if (method !== "GET") window.dispatchEvent(new Event("kh:workspace-mutation"));
  return data as T;
}
export function governanceFailure(error: unknown): GovernanceFailure {
  return error instanceof GovernanceRequestError
    ? error.failure
    : { code: "REQUEST_FAILED", message: "Unable to connect. Please try again." };
}
export function GovernanceError({ error }: { error: GovernanceFailure | null }) {
  if (!error) return null;
  const message =
    error.code === "NOT_FOUND"
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
