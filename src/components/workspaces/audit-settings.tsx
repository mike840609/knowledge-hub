"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import type { AuditPage } from "@/server/workspace-admin";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "./governance-error";
const eventLabels: Record<string, string> = {
  MEMBER_ADDED: "Added a member", ROLE_CHANGED: "Changed a member’s role", REMOVED: "Removed a member",
  GROUP_MAPPING_ADDED: "Linked a group", GROUP_MAPPING_ROLE_CHANGED: "Changed a group’s role", GROUP_MAPPING_REMOVED: "Unlinked a group",
  WORKSPACE_CREATED: "Created the workspace", WORKSPACE_RENAMED: "Renamed the workspace", WORKSPACE_ARCHIVED: "Archived the workspace", WORKSPACE_RESTORED: "Restored the workspace",
  SHARE_LINK_CREATED: "Created a share link", SHARE_LINK_REVOKED: "Revoked a share link", PERSONAL_WORKSPACE_PROVISIONED: "Created My Space",
};
function readableName(value: string): string { return value.toLowerCase().replaceAll("_", " "); }
export function AuditSettings({
  workspaceId,
  initialPage,
}: {
  workspaceId: string;
  initialPage: AuditPage;
}) {
  const [page, setPage] = useState(initialPage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  useEffect(() => setPage(initialPage), [initialPage]);
  return (
    <section className="space-y-4">
      <h2 className="text-title font-semibold">Audit</h2>
      {page.items.length === 0 && <p>No audit events yet.</p>}
      <ol className="space-y-3">
        {page.items.map((item) => (
          <li key={item.id} className="rounded-md border border-kh-border p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-medium">{eventLabels[item.eventType] ?? readableName(item.eventType)}</p>
              <Timestamp value={item.createdAt} className="text-caption text-kh-text-muted" />
            </div>
            <p className="mt-1 text-body">
              Actor: {item.actorName ?? "Unknown actor"}
            </p>
            <p className="text-body">
              Target: {readableName(item.targetType)}
            </p>
            {(
              <details className="mt-2 text-body">
                <summary className="cursor-pointer">Technical details</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify({ event: item.eventType, target: item.targetType, id: item.targetId, before: item.before, after: item.after }, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
      <GovernanceError error={error} />
      {page.nextCursor && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const next = await governanceRequest<AuditPage>(
                `/api/workspaces/${workspaceId}/audit?cursor=${encodeURIComponent(page.nextCursor!)}`,
              );
              setPage((current) => ({
                items: [
                  ...current.items,
                  ...next.items.filter(
                    (item) => !current.items.some((existing) => existing.id === item.id),
                  ),
                ],
                nextCursor: next.nextCursor,
              }));
            } catch (failure) {
              setError(governanceFailure(failure));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}
