"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";

export function DocumentEditor({
  workspaceId,
  sourceId,
  documentId,
  expectedCurrentRevisionId,
  initialTitle,
  initialMarkdown,
}: {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  expectedCurrentRevisionId: string;
  initialTitle: string;
  initialMarkdown: string;
}) {
  const router = useRouter();
  const { confirmed } = useWorkspaceAuthorization();
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const documentHref = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;

  async function save() {
    if (busy || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await governanceRequest(`/api/documents/${documentId}`, "PATCH", { title, markdown, expectedCurrentRevisionId });
      router.push(documentHref);
      router.refresh();
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  const conflict = error?.code === "REVISION_CONFLICT";

  return (
    <form
      className="mx-auto w-full max-w-[860px] space-y-4 px-6 py-6"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <label className="block text-sm text-kh-text">
        Title
        <Input className="mt-1" value={title} maxLength={512} required disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="block text-sm text-kh-text">
        Markdown
        <Textarea className="mt-1 min-h-[24rem]" value={markdown} disabled={busy} onChange={(event) => setMarkdown(event.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !confirmed || !title.trim()}>Save</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => router.push(documentHref)}>
          Cancel
        </Button>
      </div>
      {conflict ? (
        <p role="alert" className="rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-sm text-kh-text">
          這份文件已被其他人更新。你的輸入仍保留在表單中。
          <a className="ml-2 font-medium text-kh-link underline underline-offset-2" href={`${documentHref}/edit`}>重新載入最新版本</a>
        </p>
      ) : (
        <GovernanceError error={error} />
      )}
    </form>
  );
}
