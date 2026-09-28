"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { DocumentComposer } from "./document-composer";

type Created = { documentId: string; sourceId: string };

export function NewDocumentForm({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<GovernanceFailure | null>(null);

  if (!access.actions.canWrite) return null;
  const listHref = `/w/${workspaceId}/knowledge`;

  async function create(body: unknown): Promise<string> {
    const created = await governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", body);
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
      draftKey={{ kind: "new", workspaceId }}
      location={[{ label: "Documents", href: listHref }]}
      untitledLabel="New document"
      metadataTitle={undefined}
      initialTitle=""
      initialMarkdown=""
      currentRevisionId={null}
      submitLabel="Create document"
      cancelHref={listHref}
      conflictHref={null}
      onSubmit={({ title, markdown }) => create({ title, markdown })}
      footer={
        <div className="space-y-2 border-t border-kh-border pt-4">
          <label className="text-body text-kh-text-muted">
            <span className="cursor-pointer underline-offset-4 hover:underline">Upload .md</span> to Notes in {workspaceName} instead.
            <input
              type="file"
              accept=".md,.markdown"
              className="sr-only"
              disabled={uploading || !confirmed}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
          <GovernanceError error={uploadError} />
        </div>
      }
    />
  );
}
