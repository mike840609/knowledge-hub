"use client";

import { useRouter } from "next/navigation";
import { requestWorkspaceAccessCheck, useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { useEffect, useRef, useState } from "react";
import type { ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from "@/modules/sources/domain/import-limits";

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
const ASSET_HASH_CONCURRENCY = 4;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type FolderImportClientLimits = Pick<ImportLimits, "maxAssetFileBytes" | "maxAssetTotalBytes">;
const DEFAULT_CLIENT_LIMITS: FolderImportClientLimits = {
  maxAssetFileBytes: DEFAULT_IMPORT_LIMITS.maxAssetFileBytes,
  maxAssetTotalBytes: DEFAULT_IMPORT_LIMITS.maxAssetTotalBytes,
};

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

function importLimitError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "IMPORT_LIMIT_EXCEEDED" });
}

async function buildManifest(
  staged: StagedFile[],
  limits: FolderImportClientLimits,
  signal?: AbortSignal,
): Promise<ImportManifestEntry[]> {
  let assetTotalBytes = 0;
  const assetIndexes: number[] = [];
  const manifest = new Array<ImportManifestEntry>(staged.length);

  staged.forEach((entry, index) => {
    if (entry.markdown) {
      manifest[index] = { uploadKey: entry.uploadKey, relativePath: entry.relativePath, kind: "MARKDOWN", size: entry.file.size };
      return;
    }
    if (entry.file.size > limits.maxAssetFileBytes) {
      throw importLimitError("Asset file exceeds the configured per-file byte limit.");
    }
    assetTotalBytes += entry.file.size;
    if (assetTotalBytes > limits.maxAssetTotalBytes) {
      throw importLimitError("Assets exceed the configured total byte limit.");
    }
    assetIndexes.push(index);
  });

  let cursor = 0;
  const workers = Array.from({ length: Math.min(ASSET_HASH_CONCURRENCY, assetIndexes.length) }, async () => {
    while (cursor < assetIndexes.length) {
      const position = cursor;
      cursor += 1;
      if (signal?.aborted) {
        throw Object.assign(new Error("Import was cancelled."), { code: "IMPORT_CANCELLED" });
      }
      const index = assetIndexes[position];
      const entry = staged[index];
      const digest = await crypto.subtle.digest("SHA-256", await entry.file.arrayBuffer());
      manifest[index] = {
        uploadKey: entry.uploadKey,
        relativePath: entry.relativePath,
        kind: "ASSET",
        size: entry.file.size,
        contentHash: toHex(digest),
        mimeType: entry.file.type || null,
        lastModified: entry.file.lastModified ? new Date(entry.file.lastModified) : null,
      };
    }
  });
  await Promise.all(workers);
  return manifest;
}

/**
 * Design §20.7: the machine-readable `code` is the only signal the UI branches
 * on. HTTP 409 covers four distinct import codes, so a bare status can never
 * stand in for one of them — an envelope without a code is simply unknown.
 */
function readErrorEnvelope(body: unknown): { code: string; message?: string } | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = (body as { error: unknown }).error;
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const { code, message } = error as { code: unknown; message?: unknown };
  if (typeof code !== "string" || code.length === 0) return null;
  return { code, ...(typeof message === "string" && message.length > 0 ? { message } : {}) };
}

export function readErrorCode(body: unknown, fallback: string): { code: string; message: string } {
  const envelope = readErrorEnvelope(body);
  if (!envelope) return { code: "IMPORT_REQUEST_FAILED", message: fallback };
  return { code: envelope.code, message: envelope.message ?? fallback };
}

async function fetchWithTransientRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (init.signal?.aborted) {
      throw Object.assign(new Error("Import was cancelled."), { code: "IMPORT_CANCELLED" });
    }
    try {
      const response = await fetch(url, init);
      if (attempt === 1 || !TRANSIENT_HTTP_STATUSES.has(response.status)) return response;
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) {
        throw Object.assign(new Error("Import was cancelled."), { code: "IMPORT_CANCELLED" });
      }
      if (attempt === 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Import request failed.");
}

async function bestEffortAbandonImport(snapshotId: string): Promise<void> {
  try {
    await fetch(`/api/source-imports/${snapshotId}`, { method: "DELETE", keepalive: true });
  } catch {
    // The BUILDING TTL is the final fallback if the browser is already offline.
  }
}

async function postJson(
  url: string,
  payload: unknown,
  options: { knownSnapshot?: boolean; retryTransient?: boolean; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal,
  };
  const response = options.retryTransient
    ? await fetchWithTransientRetry(url, init)
    : await fetch(url, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  // Once a snapshot id is known, a 404 means that import session is missing,
  // expired/cleaned up, or not owned by this caller. Revoked Workspace access
  // for a known snapshot is intentionally translated by the server to 403.
  // Do not turn an import-session 404 into a Workspace-wide access pause.
  if (!response.ok && !(options.knownSnapshot && response.status === 404)) {
    requestWorkspaceAccessCheck(response.status, readErrorEnvelope(body)?.code);
  }
  return { ok: response.ok, status: response.status, body };
}

async function uploadMarkdownBatches(
  snapshotId: string,
  staged: StagedFile[],
  onProgress: (uploaded: number, total: number) => void,
  assertAllowed: () => void,
  signal?: AbortSignal,
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
      assertAllowed();
      const form = new FormData();
      form.set(
        "entries",
        JSON.stringify(chunk.map((entry, index) => ({ uploadKey: entry.uploadKey, field: `file-${index}` }))),
      );
      chunk.forEach((entry, index) => form.set(`file-${index}`, entry.file));
      const response = await fetchWithTransientRetry(
        `/api/source-imports/${snapshotId}/entries`,
        { method: "POST", body: form, signal },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status !== 404) {
          requestWorkspaceAccessCheck(response.status, readErrorEnvelope(body)?.code);
        }
        const failure = readErrorCode(body, "Uploading folder entries failed.");
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
  assertAllowed?: () => void;
  limits?: FolderImportClientLimits;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    target,
    files,
    sourceName,
    onProgress,
    assertAllowed = () => {},
    limits = DEFAULT_CLIENT_LIMITS,
    signal,
  } = input;
  assertAllowed();
  onProgress({ kind: "PREPARING" });
  const selection = selectFolder(files);
  const manifest = await buildManifest(selection.staged, limits, signal);
  assertAllowed();
  const session = target.kind === "new"
    ? await postJson(`/api/workspaces/${target.workspaceId}/source-imports`, {
      sourceName: sourceName.trim() || selection.rootName,
      rootName: selection.rootName,
      manifest,
    }, { signal })
    : await postJson(`/api/sources/${target.sourceId}/source-imports`, { rootName: selection.rootName, manifest }, { signal });
  if (!session.ok || !session.body || typeof session.body !== "object" || !("snapshotId" in session.body)) {
    const failure = readErrorCode(session.body, "Creating the import session failed.");
    onProgress({ kind: "ERROR", code: failure.code, message: failure.message });
    throw Object.assign(new Error(failure.message), { code: failure.code });
  }
  const snapshotId = (session.body as { snapshotId: string }).snapshotId;
  try {
    onProgress({ kind: "UPLOADING", uploaded: 0, total: selection.staged.filter((entry) => entry.markdown).length });
    await uploadMarkdownBatches(snapshotId, selection.staged, (uploaded, total) =>
      onProgress({ kind: "UPLOADING", uploaded, total }), assertAllowed, signal,
    );
    assertAllowed();
    onProgress({ kind: "FINALIZING" });
    const finalized = await postJson(
      `/api/source-imports/${snapshotId}/finalize`,
      {},
      { knownSnapshot: true, retryTransient: true, signal },
    );
    if (!finalized.ok) {
      const failure = readErrorCode(finalized.body, "Finalizing the import preview failed.");
      onProgress({ kind: "ERROR", code: failure.code, message: failure.message });
      throw Object.assign(new Error(failure.message), { code: failure.code });
    }
    return snapshotId;
  } catch (error) {
    await bestEffortAbandonImport(snapshotId);
    throw error;
  }
}

function statusText(state: ImportUiState): string | null {
  if (state.kind === "PREPARING") return "Preparing the folder manifest…";
  if (state.kind === "UPLOADING") return `Uploading Markdown files… ${state.uploaded}/${state.total}`;
  if (state.kind === "FINALIZING") return "Analyzing the folder and building the preview…";
  if (state.kind === "ERROR") return `${state.code}: ${state.message}`;
  return null;
}

export function FolderImportForm({
  target,
  limits = DEFAULT_CLIENT_LIMITS,
}: {
  target: FolderImportTarget;
  limits?: FolderImportClientLimits;
}): React.JSX.Element {
  const router = useRouter();
  const { access, confirmed } = useWorkspaceAuthorization();
  const allowed = confirmed && access.actions.canImport;
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const mountedRef = useRef(false);
  const activeImportRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // React Strict Mode intentionally runs setup → cleanup → setup once in
    // development. Resetting this flag in setup makes that probe harmless;
    // permission state stays exclusively in allowedRef.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeImportRef.current?.abort();
    };
  }, []);
  const assertAllowed = () => {
    if (!mountedRef.current) {
      throw Object.assign(new Error("Import was cancelled because this page is no longer active."), { code: "IMPORT_CANCELLED" });
    }
    if (!allowedRef.current) throw Object.assign(new Error("Workspace access changed. Import is paused."), { code: "WORKSPACE_ACCESS_CHANGED" });
  };
  const [state, setState] = useState<ImportUiState>({ kind: "IDLE" });
  const [sourceName, setSourceName] = useState("");
  const busy = state.kind === "PREPARING" || state.kind === "UPLOADING" || state.kind === "FINALIZING";
  const status = statusText(state);

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    const controller = new AbortController();
    activeImportRef.current?.abort();
    activeImportRef.current = controller;
    try {
      const snapshotId = await runFolderImport({
        target,
        files,
        sourceName,
        onProgress: setState,
        assertAllowed,
        limits,
        signal: controller.signal,
      });
      assertAllowed();
      router.push(`/w/${target.workspaceId}/sources/imports/${snapshotId}`);
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "IMPORT_REQUEST_FAILED";
      // An actual page leave is cancellation, not an authorization failure,
      // and there is no mounted UI left to update.
      if (!mountedRef.current || code === "IMPORT_CANCELLED") return;
      setState({ kind: "ERROR", code, message: error instanceof Error ? error.message : "Importing the folder failed." });
    } finally {
      if (activeImportRef.current === controller) activeImportRef.current = null;
    }
  }

  if (!allowed) return <p role="status" className="p-4 text-body text-kh-text-muted">Import is unavailable while this workspace is read-only or access is being checked.</p>;

  return (
    <div className="rounded-md border border-kh-border bg-kh-bg p-4">
      {target.kind === "new" ? (
        <>
          <label className="block text-body font-medium text-kh-text" htmlFor="import-source-name">Source name</label>
          <input
            id="import-source-name"
            className="mt-1 w-full rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-body text-kh-text outline-none placeholder:text-kh-text-muted focus:border-kh-focus kh-focus-ring"
            value={sourceName}
            disabled={busy}
            onChange={(event) => setSourceName(event.target.value)}
            placeholder="Defaults to the selected folder name"
          />
        </>
      ) : (
        <p className="text-body text-kh-text-muted">
          Re-select the full folder of <span className="font-medium text-kh-text">{target.sourceName}</span> to preview the next sync.
          The source folder stays authoritative; nothing is applied until you confirm the preview.
        </p>
      )}
      <label className="mt-3 block text-body font-medium text-kh-text" htmlFor="import-folder">Folder</label>
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
        className="mt-1 w-full rounded-md text-body text-kh-text outline-none kh-focus-ring"
      />
      {status ? <p role="status" className="mt-3 text-body text-kh-text-muted">{status}</p> : null}
    </div>
  );
}
