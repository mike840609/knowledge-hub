import { notFound } from "next/navigation";
import { MarkdownArticle } from "@/components/knowledge/markdown-article";
import { NewDocumentForm } from "@/components/knowledge/new-document-form";
import { parseSeedTitle } from "@/server/authoring-input";
import { findHubFolderLabel, findReadableDocumentHref, getWorkspaceShellModel } from "@/server/knowledge-read";
import { isUuid } from "@/shared/ids/uuidv7";

/**
 * `?folder=<tree node ID>` makes the new document go inside that folder. It is a navigation input, not
 * proof of anything: a value that is not an ID is ignored, and one that is an ID but names nothing the
 * reader may write into is passed on all the same, for the create request to refuse in words.
 *
 * `?title=` starts the document from the name a broken link gave it, and `?from=<document ID>` says
 * which document to go back to on Cancel. Both are the same kind of input: a title the create request
 * would refuse (empty, too long) is left out, and `from` is followed only if it names a document of
 * this workspace that the reader can read — otherwise Cancel goes to the list, as ever.
 */
export default async function NewNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ folder?: string | string[]; title?: string | string[]; from?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  const model = await getWorkspaceShellModel(workspaceId);
  if (!model?.access.actions.canWrite) notFound();
  const { folder, title, from } = await searchParams;
  const folderId = typeof folder === "string" && isUuid(folder) ? folder : null;
  const folderLabel = folderId ? await findHubFolderLabel(workspaceId, folderId) : null;
  const seedTitle = parseSeedTitle(title);
  const cancelHref = typeof from === "string" && isUuid(from) ? await findReadableDocumentHref(workspaceId, from) : null;
  return (
    <NewDocumentForm
      workspaceId={workspaceId}
      workspaceName={model.workspace.name}
      userId={model.identityId}
      standIn={<MarkdownArticle markdown="" />}
      folder={folderId ? { id: folderId, label: folderLabel } : null}
      seedTitle={seedTitle}
      cancelHref={cancelHref}
    />
  );
}
