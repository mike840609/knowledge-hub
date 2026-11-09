"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Archive or restore a Task Result, offered in the page header the way a
 * source's lifecycle action is. The page owns the record's state; this is the
 * one control that writes it.
 */
export function TaskLifecycleAction({ workspaceId, taskResultId, lifecycle }: { workspaceId: string; taskResultId: string; lifecycle: "ACTIVE" | "ARCHIVED" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = lifecycle === "ARCHIVED";

  async function toggleLifecycle() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/task-results/${taskResultId}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: archived ? "restore" : "archive" }),
      });
      if (!response.ok) {
        setError("The task could not be updated. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("The task could not be updated. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" disabled={busy} onClick={toggleLifecycle}>{archived ? "Restore" : "Archive"}</Button>
      {error ? <p role="alert" className="max-w-[12rem] text-right text-caption text-kh-danger">{error}</p> : null}
    </div>
  );
}
