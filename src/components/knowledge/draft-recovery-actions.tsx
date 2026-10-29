"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { governanceFailure, governanceRequest } from "@/components/workspaces/governance-error";
import { organizeFailure } from "@/components/knowledge/organize-messages";
import { downloadMarkdown } from "@/lib/download-markdown";
import { buildRecoveryMarkdown } from "@/lib/recovery-markdown";

export function DraftRecoveryActions({ workspaceId, sourceId, documentId, title, markdown, metadata = {}, canRestore }: {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  title: string;
  markdown: string;
  metadata?: Record<string, unknown>;
  canRestore: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);

  async function restore() {
    setRestoring(true);
    try {
      await governanceRequest(`/api/documents/${documentId}/restore`, "POST");
      toast({ message: `Restored “${title}”.` });
      router.push(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`);
    } catch (error) {
      toast({ message: organizeFailure(governanceFailure(error)), tone: "danger" });
    } finally {
      setRestoring(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast({ message: "Draft copied." });
    } catch {
      toast({ message: "Could not copy the draft. Select the text and copy it manually.", tone: "danger" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRestore && (
        <Button variant="secondary" disabled={restoring} onClick={() => void restore()}>
          <RotateCcw size={14} aria-hidden="true" />
          {restoring ? "Restoring…" : "Restore document"}
        </Button>
      )}
      <Button variant="ghost" onClick={async () => {
        const output = await buildRecoveryMarkdown({ title, markdown, metadata });
        downloadMarkdown(output.title, output.markdown, { recovery: output.recovery });
      }}>
        <Download size={14} aria-hidden="true" />
        Download draft
      </Button>
      <Button variant="ghost" onClick={() => void copy()}>
        <Copy size={14} aria-hidden="true" />
        Copy text
      </Button>
    </div>
  );
}
