"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";
import { runFolderImport, type FolderImportTarget, type ImportUiState } from "@/components/imports/folder-import-form";

export type { ImportUiState };
export { readErrorCode } from "@/components/imports/folder-import-form";

export function SourceImportLauncher({ workspaceId, source }: { workspaceId: string | undefined; source: SourceView | undefined }) {
  const router = useRouter();
  const [state, setState] = useState<ImportUiState>({ kind: "IDLE" });
  const [sourceName, setSourceName] = useState("");
  const busy = state.kind === "PREPARING" || state.kind === "UPLOADING" || state.kind === "FINALIZING";
  const syncable = source !== undefined && source.status === "ACTIVE" && source.ownership === "SOURCE_MANAGED" && source.sourceType === "FOLDER_SYNC";

  async function runImport(mode: "initial" | "resync", files: FileList | null, explicitSourceName: string): Promise<void> {
    if (!files || files.length === 0 || !workspaceId) return;
    if (mode === "resync" && !source) return;
    const target: FolderImportTarget = mode === "initial"
      ? { kind: "new", workspaceId }
      : { kind: "existing", workspaceId, sourceId: source?.id ?? "", sourceName: source?.name ?? "" };
    try {
      const snapshotId = await runFolderImport({ target, files, sourceName: explicitSourceName, onProgress: setState });
      router.push(`/knowledge/imports/${snapshotId}`);
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "IMPORT_REQUEST_FAILED";
      setState({ kind: "ERROR", code, message: error instanceof Error ? error.message : "Importing the folder failed." });
    }
  }

  function statusText(): string | null {
    if (state.kind === "PREPARING") return "Preparing the folder manifest…";
    if (state.kind === "UPLOADING") return `Uploading Markdown files… ${state.uploaded}/${state.total}`;
    if (state.kind === "FINALIZING") return "Analyzing the folder and building the preview…";
    if (state.kind === "ERROR") return `${state.code}: ${state.message}`;
    return null;
  }

  if (!workspaceId) return null;
  const status = statusText();
  return (
    <section aria-labelledby="import-heading" className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 id="import-heading" className="text-xl font-semibold text-ink">Folder import</h2>
        <p className="mt-1 text-sm text-slate-500">Choose a local folder. The source folder stays authoritative; the Hub only previews the deterministic diff before anything is applied.</p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold text-ink">Import a new source</h3>
          <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="import-source-name">Source name</label>
          <input
            id="import-source-name"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={sourceName}
            disabled={busy}
            onChange={(event) => setSourceName(event.target.value)}
            placeholder="Defaults to the selected folder name"
          />
          <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="import-folder">Folder</label>
          <input
            id="import-folder"
            type="file"
            disabled={busy}
            ref={(element) => {
              if (element) element.setAttribute("webkitdirectory", "");
            }}
            onChange={(event) => {
              void runImport("initial", event.target.files, sourceName);
              event.target.value = "";
            }}
            className="mt-1 w-full text-sm"
          />
        </div>
        {syncable ? (
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold text-ink">Sync {source?.name}</h3>
            <p className="mt-1 text-xs text-slate-500">Based on sync version {source?.syncVersion}. Re-select the full folder to preview the next sync.</p>
            <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="sync-folder">Folder</label>
            <input
              id="sync-folder"
              type="file"
              disabled={busy}
              ref={(element) => {
                if (element) element.setAttribute("webkitdirectory", "");
              }}
              onChange={(event) => {
                void runImport("resync", event.target.files, "");
                event.target.value = "";
              }}
              className="mt-1 w-full text-sm"
            />
          </div>
        ) : null}
      </div>
      {status ? <p role="status" className="mt-3 text-sm text-slate-600">{status}</p> : null}
    </section>
  );
}
