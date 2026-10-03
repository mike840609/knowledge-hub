"use client";

import { useEffect, useState } from "react";
import { FolderUp } from "lucide-react";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { SyncNowButton } from "@/components/sources/sync-now-button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  getRememberedFolderMeta,
  isDirectoryPickerSupported,
} from "@/components/imports/folder-handle-store";
import { buttonClasses } from "@/components/ui/button";

import type { FolderImportClientLimits } from "@/components/imports/folder-import-form";

type RememberedMeta = NonNullable<ReturnType<typeof getRememberedFolderMeta>>;

/**
 * Pairs the "Update from folder" link with the one-click Sync now button.
 * The link keeps its own WorkspaceImportLink permission gate; this wrapper
 * only demotes its emphasis (primary to ghost) once a remembered folder
 * makes Sync now available. Memory is read after mount so the server and
 * client first render stay identical. The "Last folder" caption lives in
 * the Overview section (RememberedFolderRow), not in this header row.
 */
export function SourceSyncActions({
  workspaceId,
  sourceId,
  limits,
  sourceName,
  compact = false,
}: {
  workspaceId: string;
  sourceId: string;
  limits?: FolderImportClientLimits;
  sourceName?: string;
  /** List rows offer one action: sync the remembered folder, or pick one. */
  compact?: boolean;
}): React.JSX.Element {
  const [meta, setMeta] = useState<RememberedMeta | null>(null);
  const [pickerSupported, setPickerSupported] = useState(false);
  useEffect(() => {
    setPickerSupported(isDirectoryPickerSupported());
    try {
      setMeta(getRememberedFolderMeta(sourceId));
    } catch {
      setMeta(null);
    }
  }, [sourceId]);
  const hasMemory = pickerSupported && meta !== null;
  const updateHref = `/w/${workspaceId}/sources/${sourceId}/update`;
  return (
    <>
      <SyncNowButton workspaceId={workspaceId} sourceId={sourceId} sourceName={sourceName} limits={limits} compact={compact} />
      {!compact || !hasMemory ? (
        <Tooltip label="Update from folder - pick a different folder">
          <WorkspaceImportLink
            href={updateHref}
            aria-label={sourceName ? `Update from folder: ${sourceName}` : "Update from folder"}
            className={buttonClasses({ variant: compact ? "ghost" : hasMemory ? "ghost" : "primary", icon: true, className: compact ? "group hover:!bg-kh-bg-selected hover:!text-kh-selected-text focus-visible:!bg-kh-bg-selected focus-visible:!text-kh-selected-text" : undefined })}
          >
            <FolderUp size={15} aria-hidden="true" className={compact ? "transition-transform duration-200 ease-out group-hover:-translate-y-1 group-hover:scale-125 group-focus-visible:-translate-y-1 group-focus-visible:scale-125 motion-reduce:transform-none motion-reduce:transition-none" : undefined} />
          </WorkspaceImportLink>
        </Tooltip>
      ) : null}
    </>
  );
}
