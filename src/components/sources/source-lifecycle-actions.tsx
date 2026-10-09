"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/menu";
import { buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";

export function SourceLifecycleActions({ workspaceId, sourceId, sourceName, status, label = "Source actions" }: {
  workspaceId: string; sourceId: string; sourceName: string; status: "ACTIVE" | "ARCHIVED"; label?: string;
}) {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!confirmed || access.workspace.id !== workspaceId || !access.actions.canImport) return null;
  const archived = status === "ARCHIVED";
  const changeStatus = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/sources/${sourceId}/${archived ? "restore" : "archive"}`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message ?? body.error?.message ?? "Could not change source status. Try again.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change source status.");
    } finally { setBusy(false); }
  };
  return <div>
    <MenuRoot>
      <MenuTrigger disabled={busy} aria-label={label} className={buttonClasses({ variant: "ghost", icon: true })}><MoreHorizontal size={16} /></MenuTrigger>
      <MenuContent align="end"><MenuItem onClick={() => archived ? void changeStatus() : setConfirm(true)}>{archived ? "Restore source" : "Archive source"}</MenuItem></MenuContent>
    </MenuRoot>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Archive ${sourceName}?`} description="This source and its documents will be hidden from normal browsing, search and Graph. Documents and import history are retained. You can restore it from Sources → Show archived." confirmLabel="Archive source" tone="primary" onConfirm={() => void changeStatus()} />
    {error ? <p role="alert" className="max-w-64 text-caption text-kh-danger">{error}</p> : null}
  </div>;
}
