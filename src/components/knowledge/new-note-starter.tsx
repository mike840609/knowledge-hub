"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";

type Created = { documentId: string; sourceId: string };

// Module state: one create per address within a second, so a double click or a remount of this page
// opens the same note instead of making two, while New note asked for again makes another.
const SAME_REQUEST_MS = 1000;
let recent: { href: string; at: number; created: Promise<Created> } | null = null;
let arriving: string | null = null;

/** Whether the editor opening `documentId` is arriving from a note just made here; asks once. */
export function takeNewNote(documentId: string) {
  if (arriving !== documentId) return false;
  arriving = null;
  return true;
}

/**
 * A new note exists as soon as it is asked for, as a Notion page does: it is created "Untitled" (or
 * with the title a broken link gave it) and opened in the editor, where autosave takes over. The page
 * is replaced in history, so Back leaves the note rather than creating another.
 */
export function NewNoteStarter({ workspaceId, folderId, seedTitle, composeHref }: {
  workspaceId: string;
  folderId: string | null;
  seedTitle: string | null;
  /** The form with a Create button, kept for uploading a file and for drafts written there before. */
  composeHref: string;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [failure, setFailure] = useState<GovernanceFailure | null>(null);
  useEffect(() => {
    // Once per visit: a ref survives React's development double mount.
    if (started.current) return;
    started.current = true;
    const address = window.location.href;
    if (!recent || recent.href !== address || Date.now() - recent.at > SAME_REQUEST_MS) {
      recent = { href: address, at: Date.now(), created: governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", {
        title: seedTitle ?? "Untitled", markdown: "", ...(folderId ? { parentId: folderId } : {}),
      }) };
    }
    recent.created.then(created => {
      const href = `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
      arriving = created.documentId;
      refreshOnArrival(href);
      router.replace(href);
    }, error => setFailure(governanceFailure(error)));
  }, [workspaceId, folderId, seedTitle, router]);
  return (
    <div className="mx-auto max-w-reading px-4 py-8">
      {failure ? <>
        <GovernanceError error={failure} />
        <p className="mt-3 text-body"><Link className="underline" href={composeHref}>Write it in the new-document form instead</Link></p>
      </> : <p role="status" className="text-body text-kh-text-muted">Creating a new note…</p>}
    </div>
  );
}
