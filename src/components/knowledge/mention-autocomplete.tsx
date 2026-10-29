"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Select } from "@/components/ui/select";
import { reviewRequest } from "./review-thread-list";

/**
 * Whose `@` list a composer offers: a link reader's (`token`) or the owner's (`documentId`).
 * Absent, the composer offers none — an anonymous reader cannot write, and an edit never adds a mention.
 */
export type MentionScope = { token: string } | { documentId: string };
export type MentionPick = { id: string; name: string };
type Candidate = { id: string; name: string; nameEn: string | null; empId: string };
type MentionLink = { id: string; label: string | null };

const DEBOUNCE_MS = 150;
export const NO_LINK_HINT = "Create a share link first to mention someone";

/** The `@word` being typed just before the caret, when its `@` starts a word. */
export function mentionTrigger(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[1].length - 1, query: match[1] } : null;
}

/** How many times `@name` stands in the text as a whole name: followed by whitespace, punctuation or the end. */
function occurrences(body: string, name: string): number {
  const written = `@${name}`;
  let count = 0;
  for (let at = body.indexOf(written); at !== -1; at = body.indexOf(written, at + 1)) {
    const next = body[at + written.length];
    if (next === undefined || /[\s\p{P}]/u.test(next)) count++;
  }
  return count;
}

/**
 * The picks (oldest first) the text still holds: each needs its own `@name`. When several picks
 * share a name, only as many as the text has occurrences are kept, the most recent first.
 */
export function livePicks(body: string, picks: readonly MentionPick[]): MentionPick[] {
  const left = new Map<string, number>();
  const kept: MentionPick[] = [];
  for (const pick of [...picks].reverse()) {
    const remaining = left.get(pick.name) ?? occurrences(body, pick.name);
    left.set(pick.name, remaining - 1);
    if (remaining > 0) kept.unshift(pick);
  }
  return kept;
}

/** Who the text mentions: the ids of its live picks, once each. */
export function mentionedIds(body: string, picks: readonly MentionPick[]): string[] {
  return [...new Set(livePicks(body, picks).map(pick => pick.id))];
}

/**
 * The `@` list for a composer's field. `field` goes on the textarea (a native textbox that points at the list: `aria-autocomplete`, `aria-controls`, `aria-activedescendant`) and `track` in its `onChange`,
 * `list` under it, `linkChoice` before the form's buttons. `collect` says who the text mentions,
 * and for the owner through which live link; `reset` forgets the picks once the comment is sent.
 */
export function useMentionAutocomplete(scope: MentionScope | undefined, body: string, setBody: (value: string) => void) {
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<number>();
  const [found, setFound] = useState<{ query: string; candidates: Candidate[] }>();
  const [failure, setFailure] = useState<string>();
  const [active, setActive] = useState(0);
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [links, setLinks] = useState<MentionLink[]>();
  const [linkId, setLinkId] = useState<string>();
  // A request in flight, and whether the last answer had a live link: one with none is asked again on the next `@`.
  const linksLoading = useRef(false);
  const linksFound = useRef(false);
  const owner = scope && "documentId" in scope ? scope.documentId : undefined;
  const token = scope && "token" in scope ? scope.token : undefined;

  const trigger = scope ? mentionTrigger(body, Math.min(caret, body.length)) : null;
  const open = !!trigger && trigger.start !== dismissed;
  const query = open ? trigger.query : "";
  const noLink = !!owner && links?.length === 0;
  const searchable = open && query.length > 0 && (!owner || (links?.length ?? 0) > 0);

  const triggerStart = trigger?.start;
  // The owner mentions through a live link of the document. Its links are read when the list opens,
  // and read again on each new `@` until one is live: the owner may have just created it.
  useEffect(() => {
    if (!open || !owner || linksLoading.current || linksFound.current) return;
    linksLoading.current = true;
    reviewRequest<{ links: Array<MentionLink & { active: boolean }> }>(`/api/documents/${encodeURIComponent(owner)}/share-links`)
      .then(result => {
        const live = result.links.filter(link => link.active).map(({ id, label }) => ({ id, label }));
        linksFound.current = live.length > 0;
        setLinks(live); setFailure(undefined);
      })
      .catch(error => setFailure(error instanceof Error ? error.message : "Could not load share links."))
      .finally(() => { linksLoading.current = false; });
  }, [open, owner, triggerStart]);

  useEffect(() => {
    if (!searchable) return;
    let current = true;
    const timer = window.setTimeout(() => {
      const door = owner ? `documentId=${encodeURIComponent(owner)}` : `token=${encodeURIComponent(token!)}`;
      reviewRequest<{ candidates: Candidate[] }>(`/api/review-mentions/candidates?query=${encodeURIComponent(query)}&${door}`)
        .then(result => { if (current) { setFound({ query, candidates: result.candidates }); setActive(0); setFailure(undefined); } })
        .catch(error => { if (current) setFailure(error instanceof Error ? error.message : "Could not find people."); });
    }, DEBOUNCE_MS);
    return () => { current = false; window.clearTimeout(timer); };
  }, [searchable, query, owner, token]);

  // A pick whose name has left the text is forgotten: typing the name again does not bring it back.
  useEffect(() => {
    setPicks(previous => { const kept = livePicks(body, previous); return kept.length === previous.length ? previous : kept; });
  }, [body]);

  // A new `@` opens again what Esc closed.
  useEffect(() => { if (triggerStart === undefined) setDismissed(undefined); }, [triggerStart]);

  const candidates = searchable && found?.query === query ? found.candidates : [];
  const hint = !open ? undefined : noLink ? NO_LINK_HINT : failure;
  const listed = candidates.length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;

  function track() { if (ref.current) setCaret(ref.current.selectionStart ?? 0); }

  function pick(candidate: Candidate) {
    if (!trigger) return;
    const inserted = `@${candidate.name} `;
    const end = trigger.start + 1 + trigger.query.length;
    const next = body.slice(0, trigger.start) + inserted + body.slice(end);
    const at = trigger.start + inserted.length;
    setBody(next);
    // The newest pick last: it wins an `@name` it shares with an older one.
    setPicks(previous => [...previous.filter(item => item.id !== candidate.id), { id: candidate.id, name: candidate.name }]);
    setCaret(at);
    setFound(undefined);
    requestAnimationFrame(() => ref.current?.setSelectionRange(at, at));
    // Synchronously too: a test, or a fast Enter, reads the caret before the next frame.
    if (ref.current) { ref.current.value = next; ref.current.setSelectionRange(at, at); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Only what is shown takes a key: with nothing drawn, Esc is the form's as before.
    if (!(listed || hint) || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      // The list's, not the form's: closing it leaves the comment being written.
      event.preventDefault(); event.stopPropagation();
      setDismissed(trigger!.start);
      return;
    }
    if (!listed || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(index => (index + step + candidates.length) % candidates.length);
    } else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault(); event.stopPropagation();
      pick(candidates[Math.min(active, candidates.length - 1)]);
    }
  }

  const field = {
    ref, onKeyDown, onSelect: track, onKeyUp: track, onClick: track,
    ...(scope && {
      "aria-autocomplete": "list" as const,
      "aria-controls": listed ? listId : undefined,
      "aria-activedescendant": listed ? optionId(Math.min(active, candidates.length - 1)) : undefined,
    }),
  };

  const list: ReactNode = (listed || hint) && <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-kh-border bg-kh-bg p-1 shadow-popover">
    {listed
      ? <ul id={listId} role="listbox" aria-label="People to mention">{candidates.map((candidate, index) => <li key={candidate.id} id={optionId(index)} role="option" aria-selected={index === active}
          className={`cursor-default rounded-md px-2 py-1 ${index === active ? "bg-kh-bg-selected text-kh-selected-text" : ""}`}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => pick(candidate)}>
          <span className="block truncate text-body-sm">{candidate.name}</span>
          <span className="block truncate text-caption text-kh-text-muted">{candidate.nameEn ? `${candidate.nameEn} · ${candidate.empId}` : candidate.empId}</span>
        </li>)}</ul>
      : <p className="px-2 py-1 text-body-sm text-kh-text-muted">{hint}</p>}
  </div>;

  const mentions = mentionedIds(body, picks);
  const chosenLink = links?.find(link => link.id === linkId) ?? links?.[0];
  const linkChoice: ReactNode = owner && mentions.length > 0 && links && links.length > 1 && <label className="flex items-center justify-end gap-2 text-caption text-kh-text-muted">
    Share via
    <Select size="sm" value={chosenLink?.id} onChange={event => setLinkId(event.target.value)}>{links.map((link, index) => <option key={link.id} value={link.id}>{link.label || `Link ${index + 1}`}</option>)}</Select>
  </label>;

  function collect(text: string): { mentions: string[]; mentionLinkId?: string } {
    const ids = mentionedIds(text, picks);
    return { mentions: ids, mentionLinkId: owner && ids.length > 0 ? chosenLink?.id : undefined };
  }

  function reset() { setPicks([]); setFound(undefined); setDismissed(undefined); }

  return { field, track, list, linkChoice, collect, reset };
}
