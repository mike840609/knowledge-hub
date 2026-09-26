"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { useHydrated } from "@/components/shell/use-hydrated";
import { useFormKeys } from "@/components/knowledge/use-form-keys";
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
  // The whole form waits for hydration, not just its button. Before React
  // attaches, a submit navigates away as a GET and discards the draft, and
  // anything typed into a controlled field is overwritten by the server's
  // value the moment hydration commits. Neither is worth a dimmed field for
  // the fraction of a second it costs. See `use-hydrated`.
  const hydrated = useHydrated();
  const [title, setTitle] = useState(initialTitle);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  const ready = hydrated && !busy;
  const documentHref = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;
  const onKeyDown = useFormKeys({
    dirty: title !== initialTitle || markdown !== initialMarkdown,
    busy,
    onCancel: () => router.push(documentHref),
  });

  async function save() {
    if (busy || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await governanceRequest(`/api/documents/${documentId}`, "PATCH", { title, markdown, expectedCurrentRevisionId });
      // Just the push. The `router.refresh()` that used to follow it raced the
      // navigation it was meant to freshen and discarded it: measured on a
      // production build, a save left the reader on the editor 10 times in 60
      // with it and once in 60 without. The push fetches this route's payload
      // after the PATCH, provided nothing prefetched the document from itself
      // first; the sidebar's selected row does not, for that reason
      // (keyboard-shortcuts spec §9).
      router.push(documentHref);
    } catch (failure) {
      setError(governanceFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  const conflict = error?.code === "REVISION_CONFLICT";

  return (
    <form
      className="kh-reading-column space-y-4 py-6"
      onKeyDown={onKeyDown}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
    >
      <label className="block text-body text-kh-text">
        Title
        <Input className="mt-1" value={title} maxLength={512} required disabled={!ready} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="block text-body text-kh-text">
        Markdown
        <Textarea className="mt-1 min-h-[24rem]" value={markdown} disabled={!ready} onChange={(event) => setMarkdown(event.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" title="Save (⌘Enter)" disabled={!ready || !confirmed || !title.trim()}>Save</Button>
        <Button type="button" variant="secondary" title="Cancel (Esc)" disabled={busy} onClick={() => router.push(documentHref)}>
          Cancel
        </Button>
      </div>
      {conflict ? (
        <p role="alert" className="rounded-md border border-kh-border bg-kh-bg-subtle px-3 py-2 text-body text-kh-text">
          這份文件已被其他人更新。你的輸入仍保留在表單中。
          <a className="ml-2 font-medium text-kh-link underline underline-offset-2" href={`${documentHref}/edit`}>重新載入最新版本</a>
        </p>
      ) : (
        <GovernanceError error={error} />
      )}
    </form>
  );
}
