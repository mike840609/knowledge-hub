"use client";

import { governanceRequest } from "@/components/workspaces/governance-error";
import type { ReactNode } from "react";
import type { DocumentBreadcrumbSegment } from "./document-breadcrumb";
import { DocumentComposer } from "./document-composer";

export function DocumentEditor({
  workspaceId,
  sourceId,
  documentId,
  userId,
  standIn,
  location,
  metadataTitle,
  currentRevisionId,
  initialTitle,
  initialMarkdown,
}: {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  /** The server-resolved Hub user id: drafts are keyed per user (see `DraftKey`). */
  userId: string;
  /** The server-rendered stand-in for the editor while it loads (see `DocumentComposer`). */
  standIn: ReactNode;
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
      draftKey={{ kind: "edit", userId, documentId }}
      standIn={standIn}
      location={location}
      untitledLabel="Untitled"
      metadataTitle={metadataTitle}
      initialTitle={initialTitle}
      initialMarkdown={initialMarkdown}
      currentRevisionId={currentRevisionId}
      submitLabel="Save"
      busyLabel="Saving…"
      cancelHref={documentHref}
      conflictHref={`${documentHref}/edit`}
      onSubmit={async ({ title, markdown, expectedRevisionId }) => {
        await governanceRequest(`/api/documents/${documentId}`, "PATCH", { title, markdown, expectedCurrentRevisionId: expectedRevisionId });
        return documentHref;
      }}
    />
  );
}
