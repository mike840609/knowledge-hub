"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { browserDraftStorage, clearDraft } from "@/lib/document-draft";
import { DocumentComposer } from "./document-composer";

type Created = { documentId: string; sourceId: string };

export function NewDocumentForm({
  workspaceId,
  workspaceName,
  folder = null,
  seedTitle = null,
  cancelHref = null,
}: {
  workspaceId: string;
  workspaceName: string;
  /** Where the document goes, when it is not the top of Notes; `label` is only a caption. */
  folder?: { id: string; label: string | null } | null;
  /** The title to start from: the name a broken link gave the document. */
  seedTitle?: string | null;
  /** Where Cancel goes instead of the list: the document whose link this is for. Already checked by the page. */
  cancelHref?: string | null;
}) {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<GovernanceFailure | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!access.actions.canWrite) return null;
  const listHref = `/w/${workspaceId}/knowledge`;

  async function create(body: unknown): Promise<string> {
    const created = await governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", { ...(body as object), ...(folder ? { parentId: folder.id } : {}) });
    return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
  }

  // Upload bypasses the composer: the file is the document, and the server
  // resolves its title the way folder import does (frontmatter → H1 → filename).
  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      let markdown: string;
      try {
        markdown = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        setUploadError({ code: "INVALID_ENCODING", message: "這個檔案不是有效的 UTF-8 文字，無法上傳。" });
        return;
      }
      const href = await create({ filename: file.name, markdown });
      // The composer's own draft is for the form the upload just bypassed;
      // the label offers upload "instead", so leaving it behind would offer
      // to restore a stale draft next time this workspace's /new is opened.
      clearDraft(browserDraftStorage(), { kind: "new", workspaceId });
      refreshOnArrival(href);
      router.push(href);
    } catch (failure) {
      setUploadError(governanceFailure(failure));
    } finally {
      setUploading(false);
    }
  }

  return (
    <DocumentComposer
      workspaceId={workspaceId}
      draftKey={seedTitle === null ? { kind: "new", workspaceId } : { kind: "new", workspaceId, title: seedTitle }}
      location={[{ label: "Documents", href: listHref }, ...(folder?.label ? [{ label: folder.label }] : [])]}
      untitledLabel="New document"
      metadataTitle={undefined}
      initialTitle={seedTitle ?? ""}
      initialMarkdown=""
      currentRevisionId={null}
      submitLabel="Create document"
      busyLabel="Creating…"
      cancelHref={cancelHref ?? listHref}
      conflictHref={null}
      onSubmit={({ title, markdown }) => create({ title, markdown })}
      blocked={uploading}
      footer={({ busy }) => (
        <div className="space-y-2 border-t border-kh-border pt-4">
          {/* The button takes focus, so keyboard users see the one focus ring;
              the file input is only the picker it opens. */}
          <p className="text-body text-kh-text-muted">
            <Button
              type="button"
              variant="link"
              disabled={uploading || busy || !confirmed}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload .md
            </Button>{" "}
            to {folder ? (folder.label ? `the folder “${folder.label}”` : "that folder") : "Notes"} in {workspaceName} instead.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown"
            hidden
            tabIndex={-1}
            aria-hidden="true"
            disabled={uploading || busy || !confirmed}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <GovernanceError error={uploadError} />
        </div>
      )}
    />
  );
}
