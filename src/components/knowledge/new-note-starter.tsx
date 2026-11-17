"use client";

import { useEffect, useRef, useState } from "react";
import { bufferTyping, setTyped, takeTyped } from "./typing-ahead";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";

type Created = { documentId: string; sourceId: string };

// Module state: one create per address within a few seconds, so a double click or a remount of this
// page opens the same note instead of making two.
let recent: { href: string; at: number; created: Promise<Created> } | null = null;
let arriving: string | null = null;

/**
 * When the editor opening `documentId` is arriving from a note just made here: the title typed while
 * it was made ("" for none), and whether Enter was pressed after it. `null` otherwise. Asks once.
 */
export function takeNewNote(documentId: string): { title: string; entered: boolean } | null {
  if (arriving !== documentId) return null;
  arriving = null;
  const { text, entered } = takeTyped();
  // Not trimmed: a space typed last is the start of the next word (the save trims the title it stores).
  return { title: text, entered };
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
  const [title, setTitle] = useState("");
  const titleNow = useRef("");
  const enteredHere = useRef(false);
  // After Enter the title is done: what is typed while the note is still being made is not kept (decision 3).
  const [done, setDone] = useState(false);
  titleNow.current = title;
  useEffect(() => {
    // Once per visit: a ref survives React's development double mount.
    if (started.current) return;
    started.current = true;
    // Keys typed before this page was drawn: the start of the title, the field taking over from here.
    const early = takeTyped();
    if (early.text) setTitle(early.text);
    if (early.entered) { enteredHere.current = true; setDone(true); }
    const address = window.location.href;
    if (!recent || recent.href !== address || Date.now() - recent.at > 5000) {
      recent = { href: address, at: Date.now(), created: governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", {
        title: seedTitle ?? "Untitled", markdown: "", ...(folderId ? { parentId: folderId } : {}),
      }) };
    }
    recent.created.then(created => {
      const href = `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
      arriving = created.documentId;
      // And between leaving this page and the editor's title taking focus.
      bufferTyping(titleNow.current, true);
      if (enteredHere.current) setTyped(titleNow.current, true);
      refreshOnArrival(href);
      router.replace(href);
    }, error => setFailure(governanceFailure(error)));
  }, [workspaceId, folderId, seedTitle, router]);
  return (
    <div className="mx-auto max-w-reading px-4 py-8">
      {failure ? <>
        <GovernanceError error={failure} />
        <p className="mt-3 text-body"><Link className="underline" href={composeHref}>Write it in the new-document form instead</Link></p>
      </> : <>
        {/* Typing starts as soon as the button is pressed: what is typed here, before the note exists, is
            carried to its title (creation-flow spec, decision 3). */}
        <textarea autoFocus aria-label="Title" placeholder={seedTitle ?? "Untitled"} value={title} rows={1} maxLength={512}
          onChange={(event) => { setTitle(event.target.value); setTyped(event.target.value); }}
          readOnly={done}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            enteredHere.current = true;
            setDone(true);
            // Already made and on its way: the buffer holds the title now, and Enter ends it there too.
            setTyped(event.currentTarget.value, true);
          }}
          className="mt-14 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-page-title font-semibold tracking-tight text-kh-text outline-none placeholder:text-kh-text-muted" />
        <p role="status" className="mt-2 text-caption text-kh-text-muted">Creating a new note…</p>
      </>}
    </div>
  );
}
