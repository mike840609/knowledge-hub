"use client";

import { ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { findKeyAction, type FindController } from "./find-replace";

/**
 * The find bar (2026-11-26 spec), drawn from the plugin's snapshot into its sticky anchor. Focus lives in these
 * fields while it is open; the keys the editor handles (Mod-F, Mod-G, Mod-Alt-F) are handled here too, and Escape
 * closes it and gives the editor its caret back.
 */
export function FindBar({ controller }: { controller: FindController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [replacement, setReplacement] = useState("");
  const queryRef = useRef<HTMLInputElement>(null);
  const { open, query, matchCase, replaceOpen, editable, total, index, truncated, notice, focusToken } = snapshot;

  useEffect(() => {
    if (!open || focusToken === 0) return;
    queryRef.current?.focus();
    queryRef.current?.select();
  }, [open, focusToken]);

  if (!open) return null;
  const count = !query ? "" : total === 0 ? "No results" : `${index + 1} of ${total}${truncated ? "+" : ""}`;

  // A button that is disabled by what it just did (the last match replaced) would drop focus to the page.
  const replacing = (run: () => void) => { run(); if (controller.getSnapshot().total === 0) queryRef.current?.focus(); };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const action = findKeyAction(event.nativeEvent, true);
    if (action) {
      event.preventDefault();
      if (action === "next" || action === "previous") controller.step(action === "next" ? 1 : -1);
      else controller.open({ replace: action === "openReplace" });
    } else if (event.key === "Escape") {
      event.preventDefault();
      controller.close();
    }
  };
  const submitQuery = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    controller.step(event.shiftKey ? -1 : 1);
  };
  const submitReplacement = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    replacing(() => controller.replace(replacement));
  };
  const canReplace = editable && total > 0;

  return (
    <div role="search" aria-label="Find and replace" className="kh-find-bar" onKeyDown={onKeyDown}>
      <div className="kh-find-row">
        {editable ? (
          <Tooltip label={replaceOpen ? "Hide replace" : "Show replace"} shortcut="Meta+Alt+F Control+Alt+F">
            <Button type="button" variant="ghost" icon size="sm" aria-label={replaceOpen ? "Hide replace" : "Show replace"} aria-expanded={replaceOpen} onClick={() => controller.setReplaceOpen(!replaceOpen)}>
              {replaceOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            </Button>
          </Tooltip>
        ) : null}
        <Input ref={queryRef} size="sm" type="text" className="kh-find-field" aria-label="Find" placeholder="Find" autoComplete="off" spellCheck={false} value={query} onChange={event => controller.setQuery(event.target.value)} onKeyDown={submitQuery} />
        <span className="kh-find-count" aria-live="polite" aria-atomic="true">{notice || count}</span>
        <Tooltip label="Match case">
          <Button type="button" variant={matchCase ? "soft" : "ghost"} size="sm" aria-label="Match case" aria-pressed={matchCase} onClick={() => controller.setMatchCase(!matchCase)}>Aa</Button>
        </Tooltip>
        <Tooltip label="Previous match" shortcut="Meta+Shift+G Control+Shift+G">
          <Button type="button" variant="ghost" icon size="sm" aria-label="Previous match" disabled={total === 0} onClick={() => controller.step(-1)}><ChevronUp size={16} aria-hidden="true" /></Button>
        </Tooltip>
        <Tooltip label="Next match" shortcut="Meta+G Control+G">
          <Button type="button" variant="ghost" icon size="sm" aria-label="Next match" disabled={total === 0} onClick={() => controller.step(1)}><ChevronDown size={16} aria-hidden="true" /></Button>
        </Tooltip>
        <Tooltip label="Close" keys="Esc">
          <Button type="button" variant="ghost" icon size="sm" aria-label="Close find" onClick={() => controller.close()}><X size={16} aria-hidden="true" /></Button>
        </Tooltip>
      </div>
      {editable && replaceOpen ? (
        <div className="kh-find-row">
          <Input size="sm" type="text" className="kh-find-field" aria-label="Replace with" placeholder="Replace with" autoComplete="off" spellCheck={false} value={replacement} onChange={event => setReplacement(event.target.value)} onKeyDown={submitReplacement} />
          <Button type="button" variant="secondary" size="sm" disabled={!canReplace} onClick={() => replacing(() => controller.replace(replacement))}>Replace</Button>
          <Button type="button" variant="secondary" size="sm" disabled={!canReplace} onClick={() => replacing(() => controller.replaceAll(replacement))}>Replace all</Button>
        </div>
      ) : null}
    </div>
  );
}
