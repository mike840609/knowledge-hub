"use client";
import { useState } from "react";
export function CopySourcePath({ path }: { path: string }) {
  const [message, setMessage] = useState("");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="break-all text-caption text-kh-text-muted">{path}</code>
      <button
        type="button"
        className="rounded text-caption text-kh-link kh-focus-ring"
        onClick={() =>
          void navigator.clipboard.writeText(path).then(
            () => setMessage("Path copied"),
            () =>
              setMessage("Could not copy. Select the path to copy manually."),
          )
        }
      >
        Copy path
      </button>
      <span role="status" className="text-caption">
        {message}
      </span>
    </span>
  );
}
