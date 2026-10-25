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
 */
export function SourceNameEditor({ sourceId, name }: { sourceId: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const committing = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) return;
    setValue(name);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing, name]);

  async function commit() {
    if (committing.current) return;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = value.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    committing.current = true;
    setBusy(true);
    try {
      await requestSourceRename(sourceId, next);
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
        type="button"
        aria-label={`Rename ${name}`}
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
        className="min-w-0 truncate rounded-md text-left font-medium kh-focus-ring hover:bg-kh-bg-hover"
      >
        {name}
      </button>
    );
  }

  return (
    <Input
      ref={inputRef}
      aria-label="Source name"
      value={value}
      disabled={busy}
      autoComplete="off"
      className="min-w-0 px-1 font-medium"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          setValue(name);
          setEditing(false);
        }
      }}
    />
  );
}
