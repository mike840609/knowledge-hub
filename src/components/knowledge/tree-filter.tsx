"use client";

import { useEffect, useRef } from "react";
import { ListFilter, X } from "lucide-react";

export function TreeFilter({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }} className="flex min-h-9 items-center gap-2 rounded-md bg-kh-bg-hover px-2.5 text-kh-text-muted focus-within:ring-2 focus-within:ring-kh-focus">
      <label className="sr-only" htmlFor="tree-filter">
        Filter documents and sources
      </label>
      <ListFilter className="h-4 w-4 shrink-0" aria-hidden="true" />
      <input
        ref={inputRef}
        id="tree-filter"
        type="search"
        placeholder="Filter documents and sources"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-0 flex-1 appearance-none bg-transparent text-sm text-kh-text outline-none placeholder:text-kh-text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? <button type="button" aria-label="Clear document filter" title="Clear filter" onClick={() => { onChange(""); inputRef.current?.focus(); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-kh-bg-selected hover:text-kh-text focus-visible:ring-2 focus-visible:ring-kh-focus"><X className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
    </div>
  );
}
