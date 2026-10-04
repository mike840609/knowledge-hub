"use client";
import { isExcludedImportPath, readExcludedPaths } from "@/lib/import-exclusions";
import { ImportExclusionsSettings } from "./import-exclusions-settings";

import { useRouter } from "next/navigation";
import { requestWorkspaceAccessCheck, useWorkspaceAuthorization } from "@/components/shell/use-workspace-authorization";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  collectHandleFiles,
  forgetRememberedFolder,
  getRememberedFolderMeta,
  isDirectoryPickerSupported,
  rememberFolderHandle,
  stashPendingHandle,
  type FileSystemDirectoryHandle,
} from "@/components/imports/folder-handle-store";
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

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error("Import was cancelled."), { code: "IMPORT_CANCELLED" });
  }
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
  let failed = false;
  const workers = Array.from({ length: Math.min(ASSET_HASH_CONCURRENCY, assetIndexes.length) }, async () => {
    while (!failed && cursor < assetIndexes.length) {
      const position = cursor;
      cursor += 1;
      const index = assetIndexes[position];
      const entry = staged[index];
      try {
        assertNotCancelled(signal);
        const bytes = await entry.file.arrayBuffer();
        assertNotCancelled(signal);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        assertNotCancelled(signal);
        manifest[index] = {
          uploadKey: entry.uploadKey,
          relativePath: entry.relativePath,
          kind: "ASSET",
          size: entry.file.size,
          contentHash: toHex(digest),
          mimeType: entry.file.type || null,
          lastModified: entry.file.lastModified ? new Date(entry.file.lastModified) : null,
        };
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  // File reads and WebCrypto digests cannot be aborted. Drain the bounded
  // workers before returning so a subsequent selection cannot overlap them.
  const results = await Promise.allSettled(workers);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
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

async function fetchWithTransientRetry<T = Response>(
  url: string,
  init: RequestInit,
  readResponse: (response: Response) => Promise<T> = async (response) => response as T,
  assertAllowed: () => void = () => {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assertNotCancelled(init.signal ?? undefined);
    assertAllowed();
    try {
      const response = await fetch(url, init);
      if (attempt === 1 || !TRANSIENT_HTTP_STATUSES.has(response.status)) return await readResponse(response);
      // Release the discarded response before replaying the same request.
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      lastError = error;
      assertNotCancelled(init.signal ?? undefined);
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
  options: { knownSnapshot?: boolean; retryTransient?: boolean; signal?: AbortSignal; assertAllowed?: () => void } = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal,
  };
  const readResponse = async (response: Response) => {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      // A lost/truncated successful finalize body is safe to replay against
      // the same snapshot. Domain error responses retain their original code.
      if (response.ok && options.retryTransient) throw error;
    }
    return { ok: response.ok, status: response.status, body };
  };
  const result = options.retryTransient
    ? await fetchWithTransientRetry(url, init, readResponse, options.assertAllowed)
    : await readResponse(await fetch(url, init));
  // Once a snapshot id is known, a 404 means that import session is missing,
  // expired/cleaned up, or not owned by this caller. Revoked Workspace access
  // for a known snapshot is intentionally translated by the server to 403.
  // Do not turn an import-session 404 into a Workspace-wide access pause.
  if (!result.ok && !(options.knownSnapshot && result.status === 404)) {
    requestWorkspaceAccessCheck(result.status, readErrorEnvelope(result.body)?.code);
  }
  return result;
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
        async (response) => response,
        assertAllowed,
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
    assertAllowed: checkPermission = () => {},
    limits = DEFAULT_CLIENT_LIMITS,
    signal,
  } = input;
  const assertAllowed = () => { assertNotCancelled(signal); checkPermission(); };
  assertAllowed();
  onProgress({ kind: "PREPARING" });
  const selection = selectFolder(files);
  const exclusions = target.kind === "existing" ? readExcludedPaths(target.workspaceId, target.sourceId) : [];
  selection.staged = selection.staged.filter(entry => !isExcludedImportPath(entry.relativePath, exclusions));
  if (selection.staged.length === 0) throw Object.assign(new Error("No files remain after exclusions. Nothing was synced."), { code: "INVALID_IMPORT_MANIFEST" });
  const manifest = await buildManifest(selection.staged, limits, signal);
  assertAllowed();
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
  try {
    // Session creation is intentionally non-abortable: unlike upload/finalize,
    // it is not idempotent. If cancellation happened while it was in flight,
    // first obtain the snapshot id, then abandon that BUILDING session.
    assertAllowed();
    onProgress({ kind: "UPLOADING", uploaded: 0, total: selection.staged.filter((entry) => entry.markdown).length });
    await uploadMarkdownBatches(snapshotId, selection.staged, (uploaded, total) =>
      onProgress({ kind: "UPLOADING", uploaded, total }), assertAllowed, signal,
    );
    assertAllowed();
    onProgress({ kind: "FINALIZING" });
    const finalized = await postJson(
      `/api/source-imports/${snapshotId}/finalize`,
      {},
      { knownSnapshot: true, retryTransient: true, signal, assertAllowed },
    );
    if (!finalized.ok) {
      const failure = readErrorCode(finalized.body, "Finalizing the import preview failed.");
      onProgress({ kind: "ERROR", code: failure.code, message: failure.message });
      throw Object.assign(new Error(failure.message), { code: failure.code });
    }
    assertAllowed();
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
  if (state.kind === "ERROR") return state.message;
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
    const cancel = () => activeImportRef.current?.abort();
    window.addEventListener("pagehide", cancel);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", cancel);
      cancel();
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
  const picker = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{ name: string; count: number } | null>(null);
  const [rememberedRoot, setRememberedRoot] = useState<string | null>(null);
  const rememberedSourceId = target.kind === "existing" ? target.sourceId : null;
  useEffect(() => {
    if (!rememberedSourceId) return;
    try {
      setRememberedRoot(getRememberedFolderMeta(rememberedSourceId)?.rootName ?? null);
    } catch {
      setRememberedRoot(null);
    }
  }, [rememberedSourceId]);
  const busy = state.kind === "PREPARING" || state.kind === "UPLOADING" || state.kind === "FINALIZING";
  const status = statusText(state);

  function reportImportError(error: unknown): void {
    const code = error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : "IMPORT_REQUEST_FAILED";
    // Page leave cancels both folder picker paths without updating an unmounted UI.
    if (!mountedRef.current) return;
    if (code === "IMPORT_CANCELLED") { setState({ kind: "IDLE" }); return; }
    setState({ kind: "ERROR", code, message: error instanceof Error ? error.message : "Importing the folder failed." });
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    const controller = new AbortController();
    activeImportRef.current?.abort();
    activeImportRef.current = controller;
    setSelection({ name: relativePathOf(files[0]).split("/")[0] || "Selected folder", count: files.length });
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
      reportImportError(error);
    } finally {
      if (activeImportRef.current === controller) activeImportRef.current = null;
    }
  }

  async function handlePickedDirectory(): Promise<void> {
    const showDirectoryPicker = (window as unknown as {
      showDirectoryPicker?: (options: { mode: "read" }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    if (typeof showDirectoryPicker !== "function") {
      picker.current?.click();
      return;
    }
    let handle: FileSystemDirectoryHandle;
    try {
      assertAllowed();
      handle = await showDirectoryPicker({ mode: "read" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof Error && "code" in error && (error as { code: unknown }).code === "WORKSPACE_ACCESS_CHANGED") {
        reportImportError(error);
        return;
      }
      picker.current?.click();
      return;
    }
    const controller = new AbortController();
    activeImportRef.current?.abort();
    activeImportRef.current = controller;
    const checkActive = () => { assertNotCancelled(controller.signal); assertAllowed(); };
    try {
      checkActive();
      setState({ kind: "PREPARING" });
      const files = await collectHandleFiles(handle);
      checkActive();
      if (files.length === 0) { setState({ kind: "IDLE" }); return; }
      setSelection({ name: handle.name || "Selected folder", count: files.length });
      const snapshotId = await runFolderImport({ target, files, sourceName, onProgress: setState, assertAllowed: checkActive, limits, signal: controller.signal });
      checkActive();
      if (target.kind === "existing") {
        await rememberFolderHandle(target.sourceId, handle, handle.name);
        checkActive();
      } else {
        await stashPendingHandle(snapshotId, handle, handle.name);
        checkActive();
      }
      router.push(`/w/${target.workspaceId}/sources/imports/${snapshotId}`);
    } catch (error) {
      reportImportError(error);
    } finally {
      if (activeImportRef.current === controller) activeImportRef.current = null;
    }
  }

  function handleChooseFolder(): void {
    if (isDirectoryPickerSupported()) {
      void handlePickedDirectory();
    } else {
      picker.current?.click();
    }
  }

  async function handleForget(): Promise<void> {
    if (!rememberedSourceId) return;
    setRememberedRoot(null);
    try {
      await forgetRememberedFolder(rememberedSourceId);
    } catch {
      // Forgetting is best-effort; the hint is already cleared.
    }
  }

  if (!allowed) return <p role="status" className="p-4 text-body text-kh-text-muted">Import is unavailable while this workspace is read-only or access is being checked.</p>;

  return (
    <div className="rounded-md border border-kh-border bg-kh-bg p-4">
      {target.kind === "new" ? (
        <>
          <label className="block text-body font-medium text-kh-text" htmlFor="import-source-name">Source name</label>
          <Input
            id="import-source-name"
            className="mt-1"
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
          {rememberedRoot ? (
            <> Last synced folder: <span className="font-medium text-kh-text">{rememberedRoot}</span></>
          ) : null}
        </p>
      )}
      <p className="mt-3 text-caption text-kh-text-muted">.git and .obsidian directories are excluded from import.</p>
      {target.kind === "existing" ? <ImportExclusionsSettings workspaceId={target.workspaceId} sourceId={target.sourceId} disabled={busy} /> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={busy} aria-describedby="import-folder-selection" onClick={handleChooseFolder}>Choose folder</Button>
        <p id="import-folder-selection" className="text-body text-kh-text-muted">{selection ? `${selection.name} · ${selection.count} files` : "No folder selected"}</p>
      </div>
      {rememberedSourceId && rememberedRoot ? (
        <div className="mt-2">
          <Button type="button" variant="link" onClick={() => void handleForget()}>Forget remembered folder</Button>
        </div>
      ) : null}
      <input
        id="import-folder"
        type="file"
        disabled={busy}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        ref={(element) => {
          picker.current = element;
          if (element) element.setAttribute("webkitdirectory", "");
        }}
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {status ? <p role="status" className="mt-3 text-body text-kh-text-muted">{status}</p> : null}
      {busy ? <Button variant="secondary" className="mt-3" onClick={() => activeImportRef.current?.abort()}>Cancel import</Button> : null}
      {state.kind === "ERROR" ? <details className="mt-2 text-caption text-kh-text-muted"><summary className="cursor-pointer rounded-md kh-focus-ring">Technical details</summary><code>{state.code}</code></details> : null}
    </div>
  );
}
