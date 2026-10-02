"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { runFolderImport, type ImportUiState } from "@/components/imports/folder-import-form";
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
export function SyncNowButton({ workspaceId, sourceId }: { workspaceId: string; sourceId: string }): React.JSX.Element | null {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const allowed = confirmed && access.actions.canImport;
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  useEffect(() => () => {
    allowedRef.current = false;
  }, []);
  const assertAllowed = () => {
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

  async function handleSync(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNeedsReselect(false);
    setStatus("Preparing the folder manifest…");
    try {
      const remembered = await loadRememberedHandle(sourceId);
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
          if (state.kind === "PREPARING") setStatus("Preparing the folder manifest…");
          else if (state.kind === "UPLOADING") setStatus(`Uploading Markdown files… ${state.uploaded}/${state.total}`);
          else if (state.kind === "FINALIZING") setStatus("Analyzing the folder and building the preview…");
        },
        assertAllowed,
      });
      assertAllowed();
      await rememberFolderHandle(sourceId, remembered.handle, remembered.rootName);
      router.push(`/w/${workspaceId}/sources/imports/${snapshotId}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Syncing the remembered folder failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!pickerSupported) return null;
  if (!confirmed || !access.actions.canImport) return null;
  if (!meta) return null;

  const updateHref = `/w/${workspaceId}/sources/${sourceId}/update`;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Tooltip label={`Sync now - re-scan ${meta.rootName}`}>
        <Button type="button" variant="soft" icon disabled={busy} aria-label="Sync now" onClick={() => void handleSync()}>
          <RefreshCw size={15} aria-hidden="true" />
        </Button>
      </Tooltip>
      {status ? (
        <span role="status" className="text-caption text-kh-text-muted">
          {status}
          {needsReselect ? (
            <>
              {" "}
              <a className="rounded-md text-kh-link underline underline-offset-4 kh-focus-ring" href={updateHref}>
                Pick the folder again
              </a>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
