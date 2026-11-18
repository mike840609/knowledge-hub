"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { bufferTyping, finishTyping, takeTyped, type NewNoteDraft } from "./typing-ahead";

type Created = { documentId: string; sourceId: string };
let arriving: { documentId: string; draft: NewNoteDraft } | null = null;

/** The editor consumes its own draft once, including keystrokes during the route change. */
export function takeNewNote(documentId: string): NewNoteDraft | null {
  if (arriving?.documentId !== documentId) return null;
  const { draft } = arriving;
  arriving = null;
  finishTyping(draft);
  return draft;
}

function focusAtEnd(field: HTMLTextAreaElement | null) {
  if (!field) return;
  field.focus({ preventScroll: true });
  field.setSelectionRange(field.value.length, field.value.length);
}

/** Create at once and replace this route in history when the document is ready for autosave. */
export function NewNoteStarter({ workspaceId, folderId, seedTitle, composeHref }: {
  workspaceId: string;
  folderId: string | null;
  seedTitle: string | null;
  /** The form with a Create button, kept for uploading a file and for drafts written there before. */
  composeHref: string;
}) {
  const router = useRouter();
  const active = useRef(false);
  const initialized = useRef(false);
  const started = useRef(false);
  const requested = useRef(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [failure, setFailure] = useState<GovernanceFailure | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const titleField = useRef<HTMLTextAreaElement>(null);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const entered = useRef(false);
  const carry = useRef<NewNoteDraft | null>(null);
  const [composing, setComposing] = useState(false);
  const compositionFrame = useRef(0);

  useLayoutEffect(() => {
    active.current = true;
    if (!initialized.current) {
      initialized.current = true;
      const early = takeTyped();
      entered.current = early.entered;
      setTitle(early.text);
      setBody(early.body);
      const field = early.entered ? bodyField.current : titleField.current;
      if (field) field.value = early.entered ? early.body : early.text;
      focusAtEnd(field);
    }
    return () => {
      active.current = false;
      cancelAnimationFrame(compositionFrame.current);
    };
  }, []);

  const create = useCallback(async () => {
    if (requested.current) return;
    requested.current = true;
    setFailure(null);
    try {
      const result = await governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", {
        title: seedTitle ?? "Untitled", markdown: "", ...(folderId ? { parentId: folderId } : {}),
      });
      if (active.current) setCreated(result);
    } catch (error) {
      requested.current = false;
      if (active.current) setFailure(governanceFailure(error));
    }
  }, [workspaceId, folderId, seedTitle]);

  useEffect(() => {
    // One POST for this visit, including React's development effect replay. A new visit gets its own.
    if (started.current) return;
    started.current = true;
    void create();
  }, [create]);

  useEffect(() => {
    if (!created || composing || carry.current) return;
    const draft = bufferTyping({ text: titleField.current?.value, body: bodyField.current?.value, entered: entered.current, keepFocus: true });
    carry.current = draft;
    arriving = { documentId: created.documentId, draft };
    const href = `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
    refreshOnArrival(href);
    router.replace(href);
  }, [created, composing, router, workspaceId]);

  return (
    <div className="mx-auto max-w-reading px-4 py-8" onCompositionStart={() => {
      cancelAnimationFrame(compositionFrame.current);
      setComposing(true);
    }} onCompositionEnd={() => {
      // The browser can dispatch the final input after compositionend.
      compositionFrame.current = requestAnimationFrame(() => setComposing(false));
    }}>
      <textarea ref={titleField} aria-label="Title" placeholder={seedTitle ?? "Untitled"} value={title} rows={1} maxLength={512}
        onFocus={() => { entered.current = false; if (carry.current) carry.current.entered = false; }}
        onChange={event => {
          setTitle(event.target.value);
          if (carry.current) carry.current.text = event.target.value;
        }}
        onKeyDown={event => {
          if (event.key !== "Enter" || composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) focusAtEnd(bodyField.current);
        }}
        className="mt-14 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-page-title font-semibold tracking-tight text-kh-text outline-none placeholder:text-kh-text-muted" />
      <textarea ref={bodyField} aria-label="Content" placeholder="Write here" value={body} rows={4}
        onFocus={() => { entered.current = true; if (carry.current) carry.current.entered = true; }}
        onChange={event => {
          setBody(event.target.value);
          if (carry.current) carry.current.body = event.target.value;
        }}
        className="mt-4 block w-full resize-y border-0 bg-transparent p-0 text-reading text-kh-text outline-none placeholder:text-kh-text-muted" />
      {failure ? <>
        <GovernanceError error={failure} />
        <Button className="mt-3" onClick={() => { focusAtEnd(entered.current ? bodyField.current : titleField.current); void create(); }}>Retry creation</Button>
        <p className="mt-3 text-body"><Link className="underline" href={composeHref}>Write it in the new-document form instead</Link></p>
      </> : <p role="status" className="mt-2 text-caption text-kh-text-muted">{created ? "Opening the note…" : "Creating a new note…"}</p>}
    </div>
  );
}
