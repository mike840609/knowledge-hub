"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";

type Created = { documentId: string; sourceId: string };

export function NewDocumentForm({ workspaceId, variant }: { workspaceId: string; variant: "empty" | "sidebar" }) {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
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
    await create({ filename: file.name, markdown: await file.text() });
  }

  return (
    <div className={variant === "empty" ? "w-full space-y-3" : "space-y-2"}>
      {open ? (
        <form
          className="space-y-2"
          onSubmit={(event) => { event.preventDefault(); void create({ title, markdown: "" }); }}
        >
          <label className="block text-sm text-kh-text">
            Document title
            <Input className="mt-1" value={title} maxLength={512} required autoFocus disabled={busy} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !confirmed || !title.trim()}>Create</Button>
            <Button type="button" className="bg-transparent text-kh-text hover:brightness-100" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <Button type="button" disabled={busy || !confirmed} onClick={() => setOpen(true)}>New document</Button>
      )}
      <label className="block text-sm text-kh-text-muted">
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
