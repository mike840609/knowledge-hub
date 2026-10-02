"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { WorkspaceImportLink } from "@/components/shell/workspace-import-link";
import { SyncNowButton } from "@/components/sources/sync-now-button";
import {
  getRememberedFolderMeta,
  isDirectoryPickerSupported,
} from "@/components/imports/folder-handle-store";
import { buttonClasses } from "@/components/ui/button";

type RememberedMeta = NonNullable<ReturnType<typeof getRememberedFolderMeta>>;

/**
 * Pairs the "Update from folder" link with the one-click Sync now button.
 * The link keeps its own WorkspaceImportLink permission gate; this wrapper
 * only demotes its emphasis (primary to ghost) once a remembered folder
 * makes Sync now available. Memory is read after mount so the server and
 * client first render stay identical. The muted "Last folder" caption lives
 * here so it is rendered once, ahead of both actions.
 */
export function SourceSyncActions({
  workspaceId,
  sourceId,
}: {
  workspaceId: string;
  sourceId: string;
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
      {hasMemory && meta ? (
        <span className="text-caption text-kh-text-muted">Last folder: {meta.rootName}</span>
      ) : null}
      <SyncNowButton workspaceId={workspaceId} sourceId={sourceId} />
      <WorkspaceImportLink
        href={updateHref}
        className={buttonClasses({ variant: hasMemory ? "ghost" : "primary" })}
      >
        <RefreshCw size={15} aria-hidden="true" />
        Update from folder
      </WorkspaceImportLink>
    </>
  );
}
