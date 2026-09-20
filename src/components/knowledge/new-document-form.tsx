"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";

type Created = { documentId: string; sourceId: string };

export function NewDocumentForm({ workspaceId, variant }: { workspaceId: string; variant: "empty" | "sidebar" }) {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [open, setOpen] = useState(variant === "empty");
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);

  if (!access.actions.canWrite) return null;

  async function create(body: unknown) {
    if (busy || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const created = await governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", body);
      router.push(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
      router.refresh();
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    // Set busy before the (possibly slow) file read, not just inside create(),
    // so the input is disabled for the whole operation and a fast second file
    // pick cannot start a concurrent create.
    setBusy(true);
    try {
      // Match folder import's fatal UTF-8 decode (generic-markdown-folder-adapter.ts):
      // reject malformed UTF-8 rather than silently substituting U+FFFD, so the same
      // file stores identical content whether it arrives by import or by upload.
      let markdown: string;
      try {
        markdown = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        setError({ code: "INVALID_ENCODING", message: "這個檔案不是有效的 UTF-8 文字，無法上傳。" });
        return;
      }
      await create({ filename: file.name, markdown });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={variant === "empty" ? "w-full space-y-3" : "space-y-2"}>
      {open ? (
        <form
          className="space-y-4"
          onSubmit={(event) => { event.preventDefault(); void create({ title, markdown }); }}
        >
          <label className="block text-body text-kh-text">
            Document title
            <Input className="mt-1" value={title} maxLength={512} required autoFocus disabled={busy} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="block text-body text-kh-text">
            Content <span className="text-kh-text-muted">(Markdown)</span>
            <Textarea className="mt-1 min-h-64 resize-y" value={markdown} placeholder="Write your note…" disabled={busy} onChange={(event) => setMarkdown(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !confirmed || !title.trim()}>{busy ? "Creating…" : "Create document"}</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => {
              if (variant === "empty") {
                if ((title || markdown) && !window.confirm("Discard this draft?")) return;
                router.push(`/w/${workspaceId}/knowledge`);
              } else {
                setOpen(false);
              }
            }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button type="button" disabled={busy || !confirmed} onClick={() => setOpen(true)}>New document</Button>
      )}
      <label className="block text-body text-kh-text-muted">
        <span className="cursor-pointer underline-offset-4 hover:underline">Upload .md</span>
        <input
          type="file"
          accept=".md,.markdown"
          className="sr-only"
          disabled={busy || !confirmed}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      <GovernanceError error={error} />
    </div>
  );
}
