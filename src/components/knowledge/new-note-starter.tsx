"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { refreshOnArrival } from "@/components/shell/refresh-on-arrival";
import { GovernanceError, governanceFailure, governanceRequest, type GovernanceFailure } from "@/components/workspaces/governance-error";
import { browserDraftStorage, readDraft, syncDraft, type DraftKey } from "@/lib/document-draft";
import { bufferTyping, finishTyping, takeTyped, type NewNoteDraft } from "./typing-ahead";

type Created = { documentId: string; sourceId: string };
/** The same ten seconds the typing buffer keeps: past it, an arrival never reached its editor. */
const ARRIVAL_TTL_MS = 10_000;
let arriving: { documentId: string; draft: NewNoteDraft; at: number } | null = null;

function arrivalFor(documentId: string) {
  if (!arriving || arriving.documentId !== documentId) return null;
  if (Date.now() - arriving.at > ARRIVAL_TTL_MS) { arriving = null; return null; }
  return arriving;
}

export function hasNewNoteDraft(documentId: string): boolean {
  return arrivalFor(documentId) !== null;
}

/** The editor consumes its own draft once, including keystrokes during the route change. */
export function takeNewNote(documentId: string): NewNoteDraft | null {
  const arrival = arrivalFor(documentId);
  if (!arrival) return null;
  arriving = null;
  finishTyping(arrival.draft);
  return arrival.draft;
}

function focusAtEnd(field: HTMLTextAreaElement | null) {
  if (!field) return;
  field.focus({ preventScroll: true });
  field.setSelectionRange(field.value.length, field.value.length);
}

/** Create at once and replace this route in history when the document is ready for autosave. */
export function NewNoteStarter({ workspaceId, userId, folderId, seedTitle, composeHref }: {
  workspaceId: string;
  userId: string;
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
  const [failure, setFailure] = useState<{ error: GovernanceFailure; recoveryId: string } | null>(null);
  const [transferFailed, setTransferFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const titleField = useRef<HTMLTextAreaElement>(null);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const entered = useRef(false);
  const carry = useRef<NewNoteDraft | null>(null);
  const [composing, setComposing] = useState(false);
  const composingField = useRef<{ input: HTMLTextAreaElement; key: "text" | "body" } | null>(null);
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
      // A composition that began while navigation was already in flight can still have visible preedit text.
      if (carry.current && composingField.current) {
        const { input, key } = composingField.current;
        carry.current[key] = input.value;
      }
    };
  }, []);

  const create = useCallback(async () => {
    if (requested.current) return;
    requested.current = true;
    setFailure(null);
    setTransferFailed(false);
    try {
      const result = await governanceRequest<Created>(`/api/workspaces/${workspaceId}/documents`, "POST", {
        title: seedTitle ?? "Untitled", markdown: "", ...(folderId ? { parentId: folderId } : {}),
      });
      if (active.current) setCreated(result);
    } catch (error) {
      requested.current = false;
      if (active.current) setFailure({ error: governanceFailure(error), recoveryId: crypto.randomUUID() });
    }
  }, [workspaceId, folderId, seedTitle]);

  useEffect(() => {
    // One POST for this visit, including React's development effect replay. A new visit gets its own.
    if (started.current) return;
    started.current = true;
    void create();
  }, [create]);

  useEffect(() => {
    if (!created || composing || composingField.current || carry.current) return;
    const draft = bufferTyping({ text: titleField.current?.value, body: bodyField.current?.value, entered: entered.current, keepFocus: true });
    carry.current = draft;
    arriving = { documentId: created.documentId, draft, at: Date.now() };
    const href = `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
    refreshOnArrival(href);
    router.replace(href);
  }, [created, composing, router, workspaceId]);

  return (
    <div className="mx-auto max-w-reading px-4 py-8" onCompositionStart={event => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      cancelAnimationFrame(compositionFrame.current);
      composingField.current = { input: event.target, key: event.target === titleField.current ? "text" : "body" };
      setComposing(true);
    }} onCompositionEnd={() => {
      // The browser can dispatch the final input after compositionend.
      compositionFrame.current = requestAnimationFrame(() => {
        composingField.current = null;
        setComposing(false);
      });
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
        <GovernanceError error={failure.error} />
        <Button className="mt-3" onClick={() => { focusAtEnd(entered.current ? bodyField.current : titleField.current); void create(); }}>Retry creation</Button>
        <p className="mt-3 text-body"><Link className="underline" href={`${composeHref}&recovery=${failure.recoveryId}`} onClick={event => {
          const initial = { title: seedTitle ?? "", markdown: "" };
          const draft = { title: titleField.current?.value || initial.title, markdown: bodyField.current?.value ?? "", baseRevisionId: null };
          if (draft.title === initial.title && !draft.markdown) return;
          const key: DraftKey = { kind: "new", userId, workspaceId, recoveryId: failure.recoveryId };
          const storage = browserDraftStorage();
          syncDraft(storage, key, draft, initial);
          const saved = readDraft(storage, key);
          if (saved?.title === draft.title && saved.markdown === draft.markdown) return;
          event.preventDefault();
          setTransferFailed(true);
        }}>Write it in the new-document form instead</Link></p>
        {transferFailed && <p role="alert" className="mt-2 text-body text-kh-danger">This browser couldn’t open a recovery draft. Your text is still here.</p>}
      </> : <p role="status" className="mt-2 text-caption text-kh-text-muted">{created ? "Opening the note…" : "Creating a new note…"}</p>}
    </div>
  );
}
