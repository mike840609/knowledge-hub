"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "./governance-error";
export function ArchivedWorkspaceBanner({ workspaceId, canRestore }: { workspaceId: string; canRestore: boolean }) {
  const router = useRouter(); const { confirmed } = useWorkspaceAuthorization();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<GovernanceFailure | null>(null);
  return <aside className="border-b border-kh-warning-border bg-kh-warning-bg px-6 py-3 text-body" aria-label="Archived workspace"><p>This workspace is archived. Knowledge remains available in read-only mode.</p>{canRestore && <Button className="mt-2" disabled={busy || !confirmed} onClick={async () => { setBusy(true); setError(null); try { await governanceRequest(`/api/workspaces/${workspaceId}/restore`, "POST"); router.refresh(); } catch (failure) { setError(governanceFailure(failure)); } finally { setBusy(false); } }}>Restore workspace</Button>}<GovernanceError error={error} /></aside>;
}
