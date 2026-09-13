"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ImportManifestEntry } from "@/modules/sources/application/create-folder-import";

export type FolderImportTarget =
  | { kind: "new"; workspaceId: string }
  | {
      kind: "existing";
      workspaceId: string;
      sourceId: string;
      sourceName: string;
    };

export type ImportUiState =
  | { kind: "IDLE" }
  | { kind: "PREPARING" }
  | { kind: "UPLOADING"; uploaded: number; total: number }
  | { kind: "FINALIZING" }
  | { kind: "ERROR"; code: string; message: string };

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/iu;
const MAX_BATCH_FILES = 20;
const MAX_BATCH_BYTES = 10 * 1024 * 1024;

type StagedFile = { uploadKey: string; relativePath: string; file: File; markdown: boolean };

type FolderSelection = { rootName: string; staged: StagedFile[] };

function compareRawText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relativePathOf(file: File): string {
  const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  return raw.replace(/\\/g, "/");
}

function selectFolder(files: FileList | File[]): FolderSelection {
  const sorted = [...files].sort((left, right) => compareRawText(relativePathOf(left), relativePathOf(right)) || compareRawText(left.name, right.name));
  const first = sorted[0] ? relativePathOf(sorted[0]) : "";
  const rootName = first.includes("/") ? first.slice(0, first.indexOf("/")) : first || "import";
  const seen = new Set<string>();
  const staged: StagedFile[] = [];
  sorted.forEach((file, index) => {
    const full = relativePathOf(file);
    const relativePath = full.startsWith(`${rootName}/`) ? full.slice(rootName.length + 1) : full;
    if (!relativePath) return;
    let uploadKey = `${index}-${file.name}`;
    while (seen.has(uploadKey)) uploadKey = `${uploadKey}-x`;
    seen.add(uploadKey);
    staged.push({ uploadKey, relativePath, file, markdown: MARKDOWN_EXTENSION.test(relativePath) });
  });
  return { rootName, staged };
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildManifest(staged: StagedFile[]): Promise<ImportManifestEntry[]> {
  return Promise.all(
    staged.map(async (entry): Promise<ImportManifestEntry> => {
      if (entry.markdown) {
        return { uploadKey: entry.uploadKey, relativePath: entry.relativePath, kind: "MARKDOWN", size: entry.file.size };
      }
      const digest = await crypto.subtle.digest("SHA-256", await entry.file.arrayBuffer());
      return {
        uploadKey: entry.uploadKey,
        relativePath: entry.relativePath,
        kind: "ASSET",
        size: entry.file.size,
        contentHash: toHex(digest),
        mimeType: entry.file.type || null,
        lastModified: entry.file.lastModified ? new Date(entry.file.lastModified) : null,
      };
    }),
  );
}

/**
 * Design §20.7: the machine-readable `code` is the only signal the UI branches
 * on. HTTP 409 covers four distinct import codes, so a bare status can never
 * stand in for one of them — an envelope without a code is simply unknown.
 */
export function readErrorCode(body: unknown, fallback: string): { code: string; message: string } {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: { code?: unknown; message?: unknown } }).error;
    if (error && typeof error === "object" && typeof error.code === "string" && error.code.length > 0) {
      return { code: error.code, message: typeof error.message === "string" && error.message.length > 0 ? error.message : fallback };
    }
  }
  return { code: "IMPORT_REQUEST_FAILED", message: fallback };
}

async function postJson(url: string, payload: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

async function uploadMarkdownBatches(
  snapshotId: string,
  staged: StagedFile[],
  onProgress: (uploaded: number, total: number) => void,
): Promise<void> {
  const markdown = staged.filter((entry) => entry.markdown);
  let uploaded = 0;
  onProgress(0, markdown.length);
  for (let start = 0; start < markdown.length; start += MAX_BATCH_FILES) {
    const batch = markdown.slice(start, start + MAX_BATCH_FILES);
    const chunks: StagedFile[][] = [];
    let current: StagedFile[] = [];
    let currentBytes = 0;
    for (const entry of batch) {
      if (current.length > 0 && currentBytes + entry.file.size > MAX_BATCH_BYTES) {
        chunks.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(entry);
      currentBytes += entry.file.size;
    }
    if (current.length > 0) chunks.push(current);
    for (const chunk of chunks) {
      const form = new FormData();
      form.set(
        "entries",
        JSON.stringify(chunk.map((entry, index) => ({ uploadKey: entry.uploadKey, field: `file-${index}` }))),
      );
      chunk.forEach((entry, index) => form.set(`file-${index}`, entry.file));
      const response = await fetch(`/api/source-imports/${snapshotId}/entries`, { method: "POST", body: form });
      if (!response.ok) {
        const failure = readErrorCode(await response.json().catch(() => null), "Uploading folder entries failed.");
        throw Object.assign(new Error(failure.message), { code: failure.code });
      }
      uploaded += chunk.length;
      onProgress(uploaded, markdown.length);
    }
  }
}

/**
 * Shared folder-import session flow. HTTP contracts are unchanged:
 * POST /api/workspaces/:workspaceId/source-imports (new source),
 * POST /api/sources/:sourceId/source-imports (existing source),
 * POST /api/source-imports/:snapshotId/entries,
 * POST /api/source-imports/:snapshotId/finalize.
 * Resolves with the snapshot id; reports progress through `onProgress` and
 * throws an Error carrying the machine-readable `code` on upload failure.
 */
export async function runFolderImport(input: {
  target: FolderImportTarget;
  files: FileList | File[];
  sourceName: string;
  onProgress: (state: ImportUiState) => void;
}): Promise<string> {
  const { target, files, sourceName, onProgress } = input;
  onProgress({ kind: "PREPARING" });
  const selection = selectFolder(files);
  const manifest = await buildManifest(selection.staged);
  const session = target.kind === "new"
    ? await postJson(`/api/workspaces/${target.workspaceId}/source-imports`, {
      sourceName: sourceName.trim() || selection.rootName,
      rootName: selection.rootName,
      manifest,
    })
    : await postJson(`/api/sources/${target.sourceId}/source-imports`, { rootName: selection.rootName, manifest });
  if (!session.ok || !session.body || typeof session.body !== "object" || !("snapshotId" in session.body)) {
    const failure = readErrorCode(session.body, "Creating the import session failed.");
    onProgress({ kind: "ERROR", code: failure.code, message: failure.message });
    throw Object.assign(new Error(failure.message), { code: failure.code });
  }
  const snapshotId = (session.body as { snapshotId: string }).snapshotId;
  onProgress({ kind: "UPLOADING", uploaded: 0, total: selection.staged.filter((entry) => entry.markdown).length });
  await uploadMarkdownBatches(snapshotId, selection.staged, (uploaded, total) =>
    onProgress({ kind: "UPLOADING", uploaded, total }),
  );
  onProgress({ kind: "FINALIZING" });
  const finalized = await postJson(`/api/source-imports/${snapshotId}/finalize`, {});
  if (!finalized.ok) {
    const failure = readErrorCode(finalized.body, "Finalizing the import preview failed.");
    onProgress({ kind: "ERROR", code: failure.code, message: failure.message });
    throw Object.assign(new Error(failure.message), { code: failure.code });
  }
  return snapshotId;
}

function statusText(state: ImportUiState): string | null {
  if (state.kind === "PREPARING") return "Preparing the folder manifest…";
  if (state.kind === "UPLOADING") return `Uploading Markdown files… ${state.uploaded}/${state.total}`;
  if (state.kind === "FINALIZING") return "Analyzing the folder and building the preview…";
  if (state.kind === "ERROR") return `${state.code}: ${state.message}`;
  return null;
}

export function FolderImportForm({ target }: { target: FolderImportTarget }): React.JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<ImportUiState>({ kind: "IDLE" });
  const [sourceName, setSourceName] = useState("");
  const busy = state.kind === "PREPARING" || state.kind === "UPLOADING" || state.kind === "FINALIZING";
  const status = statusText(state);

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    try {
      const snapshotId = await runFolderImport({ target, files, sourceName, onProgress: setState });
      router.push(`/w/${target.workspaceId}/sources/imports/${snapshotId}`);
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "IMPORT_REQUEST_FAILED";
      setState({ kind: "ERROR", code, message: error instanceof Error ? error.message : "Importing the folder failed." });
    }
  }

  return (
    <div className="rounded-lg border border-kh-border bg-kh-bg p-4">
      {target.kind === "new" ? (
        <>
          <label className="block text-sm font-medium text-kh-text" htmlFor="import-source-name">Source name</label>
          <input
            id="import-source-name"
            className="mt-1 w-full rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text outline-none placeholder:text-kh-text-muted focus:border-kh-accent focus-visible:ring-2 focus-visible:ring-kh-accent"
            value={sourceName}
            disabled={busy}
            onChange={(event) => setSourceName(event.target.value)}
            placeholder="Defaults to the selected folder name"
          />
        </>
      ) : (
        <p className="text-sm text-kh-text-muted">
          Re-select the full folder of <span className="font-medium text-kh-text">{target.sourceName}</span> to preview the next sync.
          The source folder stays authoritative; nothing is applied until you confirm the preview.
        </p>
      )}
      <label className="mt-3 block text-sm font-medium text-kh-text" htmlFor="import-folder">Folder</label>
      <input
        id="import-folder"
        type="file"
        disabled={busy}
        ref={(element) => {
          if (element) element.setAttribute("webkitdirectory", "");
        }}
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
        className="mt-1 w-full rounded-md text-sm text-kh-text outline-none focus-visible:ring-2 focus-visible:ring-kh-accent"
      />
      {status ? <p role="status" className="mt-3 text-sm text-kh-text-muted">{status}</p> : null}
    </div>
  );
}
