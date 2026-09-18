"use client";

export function TreeFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="sr-only" htmlFor="tree-filter">
        Filter documents
      </label>
      <input
        id="tree-filter"
        type="search"
        placeholder="Filter documents"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 w-full rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text outline-none placeholder:text-kh-text-muted focus:border-kh-focus focus-visible:ring-2 focus-visible:ring-kh-focus"
      />
    </div>
  );
}
