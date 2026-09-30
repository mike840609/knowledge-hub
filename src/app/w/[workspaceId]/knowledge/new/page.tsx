import { notFound } from "next/navigation";
import { NewDocumentForm } from "@/components/knowledge/new-document-form";
import { findHubFolderLabel, getWorkspaceShellModel } from "@/server/knowledge-read";
import { isUuid } from "@/shared/ids/uuidv7";

/**
 * `?folder=<tree node ID>` makes the new document go inside that folder. It is a navigation input, not
 * proof of anything: a value that is not an ID is ignored, and one that is an ID but names nothing the
 * reader may write into is passed on all the same, for the create request to refuse in words.
 */
export default async function NewNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ folder?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  const model = await getWorkspaceShellModel(workspaceId);
  if (!model?.access.actions.canWrite) notFound();
  const { folder } = await searchParams;
  const folderId = typeof folder === "string" && isUuid(folder) ? folder : null;
  const folderLabel = folderId ? await findHubFolderLabel(workspaceId, folderId) : null;
  return (
    <NewDocumentForm
      workspaceId={workspaceId}
      workspaceName={model.workspace.name}
      folder={folderId ? { id: folderId, label: folderLabel } : null}
    />
  );
}
