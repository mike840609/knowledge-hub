"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { requestSourceRename } from "./rename-source-request";

/**
 * The source name in the detail header. Clicking it edits in place (Linear's
 * pattern) instead of opening a dialog: Enter or blur saves, Esc restores the
 * old name. The source id never changes, so only the label moves.
 *
 * The button keeps its visible text as its accessible name — the page <h1>
 * wraps it, so an aria-label here would rename the whole heading.
 */
export function SourceNameEditor({ sourceId, name }: { sourceId: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [shown, setShown] = useState(name);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const committing = useRef(false);
  const cancelled = useRef(false);
  const focusTitle = useRef(false);

  // Keep the local label in step with a refreshed server value (e.g. a rename
  // from another device) without flashing the old text after our own save.
  useEffect(() => setShown(name), [name]);

  useEffect(() => {
    if (!editing) {
      if (focusTitle.current) {
        focusTitle.current = false;
        buttonRef.current?.focus();
      }
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (committing.current) return;
    const next = value.trim();
    if (!next || next === shown) {
      setEditing(false);
      return;
    }
    committing.current = true;
    setBusy(true);
    try {
      await requestSourceRename(sourceId, next);
      setShown(next);
      focusTitle.current = true;
      setEditing(false);
      router.refresh();
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : "Could not rename the source.",
        tone: "danger",
      });
      inputRef.current?.focus();
    } finally {
      committing.current = false;
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        title="Rename source"
        onClick={() => {
          cancelled.current = false;
          setValue(shown);
          setEditing(true);
        }}
        className="min-w-0 truncate rounded-md text-left font-medium kh-focus-ring hover:bg-kh-bg-hover"
      >
        {shown}
      </button>
    );
  }

  return (
    <Input
      ref={inputRef}
      aria-label="Source name"
      value={value}
      readOnly={busy}
      aria-disabled={busy}
      autoComplete="off"
      className="min-w-0 px-1 font-medium"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        // An input method uses Enter and Esc to finish or abandon a composition.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          setValue(shown);
          focusTitle.current = true;
          setEditing(false);
        }
      }}
    />
  );
}
