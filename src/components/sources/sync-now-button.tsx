"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { runFolderImport, type ImportUiState, type FolderImportClientLimits } from "@/components/imports/folder-import-form";
import {
  collectHandleFiles,
  getRememberedFolderMeta,
  isDirectoryPickerSupported,
  loadRememberedHandle,
  rememberFolderHandle,
} from "@/components/imports/folder-handle-store";
import { useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";

type RememberedMeta = NonNullable<ReturnType<typeof getRememberedFolderMeta>>;

/**
 * One-click re-sync through the previously picked folder. Renders nothing
 * unless the directory picker exists, workspace access is confirmed, the
 * caller may import, and a folder is remembered for this source. The existing
 * "Update from folder" link keeps its own gate and is untouched.
 */
export function SyncNowButton({ workspaceId, sourceId, sourceName, limits, compact = false }: { workspaceId: string; sourceId: string; sourceName?: string; limits?: FolderImportClientLimits; compact?: boolean }): React.JSX.Element | null {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const allowed = confirmed && access.actions.canImport;
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const mountedRef = useRef(false);
  const activeImportRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    const cancel = () => activeImportRef.current?.abort();
    window.addEventListener("pagehide", cancel);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", cancel);
      cancel();
    };
  }, []);
  const assertAllowed = () => {
    if (!mountedRef.current || activeImportRef.current?.signal.aborted) {
      throw Object.assign(new Error("Import was cancelled."), { code: "IMPORT_CANCELLED" });
    }
    if (!allowedRef.current) {
      throw Object.assign(new Error("Workspace access changed. Import is paused."), {
        code: "WORKSPACE_ACCESS_CHANGED",
      });
    }
  };
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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [needsReselect, setNeedsReselect] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSync(): Promise<void> {
    if (activeImportRef.current) return;
    const controller = new AbortController();
    activeImportRef.current = controller;
    setBusy(true);
    setNeedsReselect(false);
    setFailed(false);
    setStatus("Checking the folder… Changes will open in a preview; Apply is required to update this source.");
    try {
      assertAllowed();
      const remembered = await loadRememberedHandle(sourceId);
      assertAllowed();
      if (!remembered) {
        setStatus("Saved folder is unavailable - pick the folder again");
        setNeedsReselect(true);
        return;
      }
      const files = await collectHandleFiles(remembered.handle);
      const snapshotId = await runFolderImport({
        target: { kind: "existing", workspaceId, sourceId, sourceName: "" },
        files,
        sourceName: "",
        onProgress: (state: ImportUiState) => {
          if (!mountedRef.current) return;
          if (state.kind === "PREPARING") setStatus("Preparing files for upload…");
          else if (state.kind === "UPLOADING") setStatus(`Uploading Markdown files… ${state.uploaded}/${state.total}`);
          else if (state.kind === "FINALIZING") setStatus("Analyzing the folder and building the preview…");
        },
        assertAllowed,
        limits,
        signal: controller.signal,
      });
      assertAllowed();
      await rememberFolderHandle(sourceId, remembered.handle, remembered.rootName);
      assertAllowed();
      setStatus("Opening preview… Review changes and select Apply to update this source.");
      router.push(`/w/${workspaceId}/sources/imports/${snapshotId}`);
    } catch (error) {
      if (!mountedRef.current) return;
      if (controller.signal.aborted) { setStatus("Checking cancelled. No changes were applied."); return; }
      setFailed(true);
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotFoundError")) setNeedsReselect(true);
      setStatus(`${error instanceof Error ? error.message : "Checking the folder failed."} No changes were applied.`);
    } finally {
      if (activeImportRef.current === controller) activeImportRef.current = null;
      if (mountedRef.current) setBusy(false);
    }
  }

  if (!pickerSupported) return null;
  if (!confirmed || !access.actions.canImport) return null;
  if (!meta) return null;

  const updateHref = `/w/${workspaceId}/sources/${sourceId}/update`;
  return (
    <span className={compact ? "contents" : "flex flex-wrap items-center gap-2"}>
      <Tooltip label={compact ? `Check for changes — scan ${meta.rootName}, then preview changes before Apply` : `Check for changes - re-scan ${meta.rootName}`}>
        <Button type="button" variant={compact ? "ghost" : "soft"} className={compact ? "group hover:!bg-kh-bg-selected hover:!text-kh-selected-text focus-visible:!bg-kh-bg-selected focus-visible:!text-kh-selected-text" : undefined} icon disabled={busy} aria-label={sourceName ? `Check for changes: ${sourceName}` : "Check for changes"} onClick={() => void handleSync()}>
          <RefreshCw size={15} aria-hidden="true" className={busy ? "animate-spin motion-reduce:animate-none" : compact ? "transition-transform duration-200 ease-out group-hover:rotate-12 group-hover:scale-110 group-focus-visible:rotate-12 group-focus-visible:scale-110 motion-reduce:transform-none motion-reduce:transition-none" : undefined} />
        </Button>
      </Tooltip>
      {busy ? <Button type="button" variant="link" onClick={()=>activeImportRef.current?.abort()}>Cancel checking</Button> : null}
      {status ? (
        <span role="status" className={compact ? "col-span-2 row-start-2 pb-2 text-caption text-kh-text-muted" : "text-caption text-kh-text-muted"}>
          {status}
          {needsReselect ? (
            <>
              {" "}
              <a className="rounded-md text-kh-link underline underline-offset-4 kh-focus-ring" href={updateHref} aria-label={sourceName ? `Choose folder to sync: ${sourceName}` : "Choose folder to sync"}>
                Pick the folder again
              </a>
            </>
          ) : failed && !busy ? (
            <Button type="button" variant="link" disabled={!allowed} aria-label={sourceName ? `Retry sync: ${sourceName}` : "Retry sync"} className="ml-2" onClick={() => void handleSync()}>
              Retry
            </Button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
