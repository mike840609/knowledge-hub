"use client";

import { useEffect, useState } from "react";
import { getRememberedFolderMeta } from "@/components/imports/folder-handle-store";

type RememberedMeta = NonNullable<ReturnType<typeof getRememberedFolderMeta>>;

/**
 * Overview metadata row for the remembered folder. Reads browser storage
 * after mount so the server and first client render output nothing.
 */
export function RememberedFolderRow({ sourceId }: { sourceId: string }): React.JSX.Element | null {
  const [meta, setMeta] = useState<RememberedMeta | null>(null);
  useEffect(() => {
    try {
      setMeta(getRememberedFolderMeta(sourceId));
    } catch {
      setMeta(null);
    }
  }, [sourceId]);
  if (!meta) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-kh-text-muted">Last folder</dt>
      <dd className="text-kh-text">{meta.rootName}</dd>
    </div>
  );
}
