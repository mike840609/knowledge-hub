"use client";

import { governanceRequest } from "@/components/workspaces/governance-error";
import type { DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { DocumentComposer } from "./document-composer";

export function DocumentEditor({
  workspaceId,
  sourceId,
  documentId,
  location,
  metadataTitle,
  currentRevisionId,
  initialTitle,
  initialMarkdown,
}: {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  location: DocumentBreadcrumbSegment[];
  metadataTitle: unknown;
  currentRevisionId: string;
  initialTitle: string;
  initialMarkdown: string;
}) {
  const documentHref = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;
  return (
    <DocumentComposer
      workspaceId={workspaceId}
      draftKey={{ kind: "edit", documentId }}
      location={location}
      untitledLabel="Untitled"
      metadataTitle={metadataTitle}
      initialTitle={initialTitle}
      initialMarkdown={initialMarkdown}
      currentRevisionId={currentRevisionId}
      submitLabel="Save"
      cancelHref={documentHref}
      conflictHref={`${documentHref}/edit`}
      onSubmit={async ({ title, markdown, expectedRevisionId }) => {
        await governanceRequest(`/api/documents/${documentId}`, "PATCH", { title, markdown, expectedCurrentRevisionId: expectedRevisionId });
        return documentHref;
      }}
    />
  );
}
