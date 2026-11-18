"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bufferTyping, setTyped, takeTyped } from "./typing-ahead";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonClasses } from "@/components/ui/button";
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
 * A new note is committed, not created by arriving: the reader types a title and presses Enter or
 * Create, and only then does the record exist. Cancel therefore leaves nothing behind, and the
 * title that was on screen is the title that is saved — the create request never sees a half-typed
 * character. Keys typed before this page was drawn are kept as the title, not as a create.
 */
export function NewNoteStarter({ workspaceId, workspaceName, folderId, seedTitle, composeHref }: {
  workspaceId: string;
  workspaceName: string;
  folderId: string | null;
  seedTitle: string | null;
  /** The form with a Create button, kept for uploading a file and for drafts written there before. */
  composeHref: string;
}) {
  const router = useRouter();
  const started = useRef(false);
  const cancelled = useRef(false);
  const created = useRef<Created | null>(null);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<GovernanceFailure | null>(null);
  const [title, setTitle] = useState("");
  const titleNow = useRef("");
  const enteredHere = useRef(false);
  // After Enter the title is done: what is typed while the note is still being made is not kept (decision 3).
  const [done, setDone] = useState(false);
  titleNow.current = title;

  const archive = useCallback((documentId: string) => {
    // keepalive: the reader is already on the way back to Knowledge.
    void fetch(`/api/documents/${documentId}/archive`, { method: "POST", keepalive: true }).catch(() => {});
  }, []);

  const create = useCallback((value: string) => {
    if (started.current || cancelled.current || (!value.trim() && !seedTitle)) return;
    started.current = true;
    setCreating(true);
    const address = window.location.href;
    if (!recent || recent.href !== address || Date.now() - recent.at > 5000) {
      recent = { href: address, at: Date.now(), created: governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", {
        title: value.trim() || seedTitle || "Untitled", markdown: "", ...(folderId ? { parentId: folderId } : {}),
      }) };
    }
    recent.created.then((createdNote) => {
      created.current = createdNote;
      if (cancelled.current) {
        archive(createdNote.documentId);
        return;
      }
      const href = `/w/${workspaceId}/knowledge/${createdNote.sourceId}/${createdNote.documentId}`;
      arriving = createdNote.documentId;
      // And between leaving this page and the editor's title taking focus.
      bufferTyping(titleNow.current, true);
      if (enteredHere.current) setTyped(titleNow.current, true);
      refreshOnArrival(href);
      router.replace(href);
    }, (error) => {
      started.current = false;
      setCreating(false);
      if (!cancelled.current) setFailure(governanceFailure(error));
    });
  }, [archive, folderId, router, seedTitle, workspaceId]);

  useEffect(() => {
    // Keys typed before this page was drawn are the start of the title; Enter there already committed.
    const early = takeTyped();
    if (early.text) setTitle(early.text);
    if (early.entered) { enteredHere.current = true; setDone(true); create(early.text); }
  }, [create]);

  const cancel = () => {
    if (creating) return;
    cancelled.current = true;
    recent = null;
    if (created.current) archive(created.current.documentId);
    router.replace(`/w/${workspaceId}/knowledge`);
  };

  const submit = () => {
    if (creating || (!titleNow.current.trim() && !seedTitle)) return;
    setDone(true);
    setTyped(titleNow.current, enteredHere.current);
    create(titleNow.current);
  };

  // Escape leaves from anywhere on the form, not only while the title field has focus.
  const creatingRef = useRef(creating);
  creatingRef.current = creating;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || creatingRef.current) return;
      event.preventDefault();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="kh-page-wide pb-6">
      <PageHeader
        location={workspaceName}
        locationHref={`/w/${workspaceId}/knowledge`}
        title="New document"
        actions={<>
          <Button onClick={submit} disabled={creating || (!title.trim() && !seedTitle)} aria-keyshortcuts="Enter">Create</Button>
          <button type="button" className={buttonClasses({ variant: "ghost" })} onClick={cancel} disabled={creating}>Cancel</button>
        </>}
      />
      <div className="mt-6 max-w-2xl">
      {failure ? <>
        <GovernanceError error={failure} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => { setFailure(null); create(titleNow.current); }}>Try again</Button>
          <Link className="text-body underline" href={composeHref}>Write it in the new-document form instead</Link>
        </div>
      </> : <>
        <label htmlFor="new-title" className="block text-caption text-kh-text-muted">Title</label>
        <textarea autoFocus id="new-title" aria-label="Title" placeholder={seedTitle ?? "Untitled"} value={title} rows={1} maxLength={512}
          onChange={(event) => {
            const value = event.target.value;
            setTitle(value);
            setTyped(value);
          }}
          readOnly={done || creating}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            enteredHere.current = true;
            submit();
          }}
          className="mt-1 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-page-title font-semibold tracking-tight text-kh-text outline-none placeholder:text-kh-text-muted" />
        <p role="status" className="mt-2 text-body-sm text-kh-text-muted">{creating ? "Creating a new note…" : "Type a title, then press Enter or Create."}</p>
      </>}
      </div>
    </div>
  );
}
