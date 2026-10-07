"use client";

/**
 * Remembers a picked local folder per source so a later one-click sync can
 * re-read the same folder without opening a directory picker.
 *
 * The FileSystemDirectoryHandle itself lives in IndexedDB (handles are
 * structured-cloneable but not JSON-serializable); only the small display
 * meta ({ rootName, lastSyncAt }) lives in localStorage.
 *
 * Every entry point tolerates private-mode / unavailable storage by
 * resolving null / no-op instead of throwing. The only throws callers can
 * see are I/O errors from collectHandleFiles while reading files.
 */

import { isIgnoredImportPath } from "@/lib/import-exclusions";

// Minimal File System Access API surface this module needs. Declared here so
// no DOM lib version or ambient @types dependency decides the shape.
export interface FileSystemPermissionDescriptor {
  mode: "read" | "readwrite";
}

export type FileSystemPermissionState = "granted" | "denied" | "prompt";

export interface FileSystemHandle {
  readonly kind: "file" | "directory";
  readonly name: string;
  queryPermission?: (descriptor: FileSystemPermissionDescriptor) => Promise<FileSystemPermissionState>;
  requestPermission?: (
    descriptor: FileSystemPermissionDescriptor,
  ) => Promise<FileSystemPermissionState>;
}

export interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: "file";
  getFile: () => Promise<File>;
}

export interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: "directory";
  values: () => AsyncIterableIterator<FileSystemHandle>;
}

export interface RememberedFolderMeta {
  rootName: string;
  lastSyncAt: string;
}

export interface RememberedHandle {
  handle: FileSystemDirectoryHandle;
  rootName: string;
}

const DB_NAME = "km-folder-handles";
const STORE_NAME = "handles";

function metaKey(sourceId: string): string {
  return `km:folder-handle:${sourceId}`;
}

function storage(): Storage | null {
  try {
    const candidate = globalThis.localStorage;
    if (!candidate) return null;
    return candidate;
  } catch {
    return null;
  }
}

function databaseFactory(): IDBFactory | null {
  try {
    const candidate = globalThis.indexedDB;
    if (!candidate) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** True only when window.showDirectoryPicker is a function. */
export function isDirectoryPickerSupported(): boolean {
  if (typeof window === "undefined") return false;
  const candidate = window as unknown as { showDirectoryPicker?: unknown };
  return typeof candidate.showDirectoryPicker === "function";
}

/** Reads the localStorage display meta; null on missing/corrupt. Corrupt entries are removed so the documented cleanup contract holds. */
export function getRememberedFolderMeta(sourceId: string): RememberedFolderMeta | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(metaKey(sourceId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      removeMeta(sourceId);
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record["rootName"] !== "string" || typeof record["lastSyncAt"] !== "string") {
      removeMeta(sourceId);
      return null;
    }
    return { rootName: record["rootName"], lastSyncAt: record["lastSyncAt"] };
  } catch {
    removeMeta(sourceId);
    return null;
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  const factory = databaseFactory();
  if (!factory) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      } catch {
        // The open will surface the failure through onerror below.
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      resolve(null);
    };
    request.onblocked = () => {
      resolve(null);
    };
  });
}

function closeDatabase(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // Closing must never fail the caller.
  }
}

function putHandle(sourceId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          resolve();
          return;
        }
        let transaction: IDBTransaction;
        try {
          transaction = db.transaction(STORE_NAME, "readwrite");
        } catch {
          closeDatabase(db);
          resolve();
          return;
        }
        const finish = (): void => {
          closeDatabase(db);
          resolve();
        };
        transaction.oncomplete = finish;
        transaction.onerror = finish;
        transaction.onabort = finish;
        try {
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(handle, sourceId);
          request.onerror = () => {
            // Transaction handlers above settle the promise.
          };
        } catch {
          finish();
        }
      }),
  );
}

function getHandle(sourceId: string): Promise<FileSystemDirectoryHandle | null> {
  return openDatabase().then(
    (db) =>
      new Promise<FileSystemDirectoryHandle | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let transaction: IDBTransaction;
        try {
          transaction = db.transaction(STORE_NAME, "readonly");
        } catch {
          closeDatabase(db);
          resolve(null);
          return;
        }
        const finish = (value: FileSystemDirectoryHandle | null): void => {
          closeDatabase(db);
          resolve(value);
        };
        transaction.onerror = () => finish(null);
        transaction.onabort = () => finish(null);
        try {
          const store = transaction.objectStore(STORE_NAME);
          const request = store.get(sourceId);
          request.onsuccess = () => {
            const value: unknown = request.result;
            if (
              typeof value !== "object" ||
              value === null ||
              (value as { kind?: unknown }).kind !== "directory"
            ) {
              finish(null);
              return;
            }
            finish(value as FileSystemDirectoryHandle);
          };
          request.onerror = () => finish(null);
        } catch {
          finish(null);
        }
      }),
  );
}

function deleteHandle(sourceId: string): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) {
          resolve();
          return;
        }
        let transaction: IDBTransaction;
        try {
          transaction = db.transaction(STORE_NAME, "readwrite");
        } catch {
          closeDatabase(db);
          resolve();
          return;
        }
        const finish = (): void => {
          closeDatabase(db);
          resolve();
        };
        transaction.oncomplete = finish;
        transaction.onerror = finish;
        transaction.onabort = finish;
        try {
          const store = transaction.objectStore(STORE_NAME);
          const request = store.delete(sourceId);
          request.onerror = () => {
            // Transaction handlers above settle the promise.
          };
        } catch {
          finish();
        }
      }),
  );
}

/**
 * Persists the handle in IndexedDB and the display meta in localStorage.
 * Storage failures (private mode, quota) are swallowed: the entry simply
 * will not be there for a later load. When the meta write is unavailable or
 * fails, the just-written handle is deleted so no orphaned entry remains.
 */
export async function rememberFolderHandle(
  sourceId: string,
  handle: FileSystemDirectoryHandle,
  rootName: string,
): Promise<void> {
  await putHandle(sourceId, handle);
  const store = storage();
  if (!store) {
    await deleteHandle(sourceId);
    return;
  }
  try {
    store.setItem(
      metaKey(sourceId),
      JSON.stringify({ rootName, lastSyncAt: new Date().toISOString() }),
    );
  } catch {
    // Private mode: the meta cannot be kept, the handle alone is useless.
    await deleteHandle(sourceId);
  }
}

async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const descriptor: FileSystemPermissionDescriptor = { mode: "read" };
  try {
    if (typeof handle.queryPermission === "function") {
      const current = await handle.queryPermission(descriptor);
      if (current === "granted") return true;
      if (current === "denied" && typeof handle.requestPermission !== "function") return false;
    }
    if (typeof handle.requestPermission === "function") {
      const next = await handle.requestPermission(descriptor);
      return next === "granted";
    }
    // Handles without permission methods predate the permission API; the
    // picker grant itself is the permission.
    return typeof handle.queryPermission !== "function";
  } catch {
    return false;
  }
}

function removeMeta(sourceId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(metaKey(sourceId));
  } catch {
    // Removal is best-effort cleanup.
  }
}

/**
 * Pending-handle two-phase flow for newly imported sources.
 *
 * A kind=new import has no sourceId at pick time, so the picked handle is
 * stashed under `pending:${snapshotId}` and adopted onto the real sourceId
 * once Apply resolves. Both the IndexedDB entry and the localStorage meta
 * reuse the same store/key scheme as remembered handles, so Sync now needs
 * no other change to find them after adoption.
 */
function pendingKey(snapshotId: string): string {
  return `pending:${snapshotId}`;
}

const PENDING_META_PREFIX = "km:folder-handle:pending:";

/**
 * Removes every stashed pending handle except the one for `exceptSnapshotId`.
 * Preview pages expire (READY 30 minutes), so abandoned pending keys must be
 * swept rather than left forever. Best-effort: never throws.
 */
async function sweepOtherPendingHandles(exceptSnapshotId: string): Promise<void> {
  const store = storage();
  if (!store) return;
  const keys: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && key.startsWith(PENDING_META_PREFIX)) keys.push(key);
    }
  } catch {
    return;
  }
  const current = metaKey(pendingKey(exceptSnapshotId));
  for (const key of keys) {
    if (key === current) continue;
    const staleSnapshotId = key.slice(PENDING_META_PREFIX.length);
    try {
      await deleteHandle(pendingKey(staleSnapshotId));
    } catch {
      // Deletion is best-effort; callers must never see a throw.
    }
    try {
      const latest = storage();
      latest?.removeItem(key);
    } catch {
      // Removal is best-effort cleanup.
    }
  }
}

/**
 * Stashes a picked folder handle under a pending key until Apply creates the
 * source. Reuses the remember path (including its orphan cleanup when the
 * meta write fails) and sweeps other abandoned pending keys. Never throws:
 * a storage failure simply means no Sync now shortcut later.
 */
export async function stashPendingHandle(
  snapshotId: string,
  handle: FileSystemDirectoryHandle,
  rootName: string,
): Promise<void> {
  try {
    await rememberFolderHandle(pendingKey(snapshotId), handle, rootName);
    await sweepOtherPendingHandles(snapshotId);
  } catch {
    // Stash is best-effort; the import itself already succeeded.
  }
}

/**
 * Moves a stashed handle+meta onto the real sourceId via the existing
 * remember path, then deletes the pending key. No-ops when nothing was
 * stashed for the snapshot. Never throws.
 */
export async function adoptPendingHandle(snapshotId: string, sourceId: string): Promise<void> {
  try {
    const pending = pendingKey(snapshotId);
    const meta = getRememberedFolderMeta(pending);
    const handle = await getHandle(pending);
    if (!meta || !handle) {
      if (meta || handle) {
        await deleteHandle(pending);
        removeMeta(pending);
      }
      return;
    }
    await rememberFolderHandle(sourceId, handle, meta.rootName);
    await deleteHandle(pending);
    removeMeta(pending);
  } catch {
    // Adoption is best-effort; callers must never see a throw.
  }
}

/**
 * Returns the remembered handle when the picker exists, a meta is stored, a
 * directory handle is stored, and read permission holds (after at most one
 * requestPermission attempt). Stale entries discovered along the way — meta
 * without a handle, corrupt meta — are deleted.
 */
export async function loadRememberedHandle(
  sourceId: string,
): Promise<RememberedHandle | null> {
  if (!isDirectoryPickerSupported()) return null;
  const meta = getRememberedFolderMeta(sourceId);
  if (!meta) {
    return null;
  }
  const handle = await getHandle(sourceId);
  if (!handle) {
    await forgetRememberedFolder(sourceId);
    return null;
  }
  const allowed = await ensureReadPermission(handle);
  if (!allowed) return null;
  return { handle, rootName: meta.rootName };
}

/** Removes both the IndexedDB entry and the localStorage meta; never throws. */
export async function forgetRememberedFolder(sourceId: string): Promise<void> {
  try {
    await deleteHandle(sourceId);
  } catch {
    // Deletion is best-effort; callers must never see a throw for empty state.
  }
  removeMeta(sourceId);
}

/**
 * Recursively walks handle.values() and returns every file. Each File gets
 * webkitRelativePath `${handle.name}/${relPath}` defined on it so the
 * existing selectFolder() derives rootName === handle.name unchanged.
 */
export async function collectHandleFiles(handle: FileSystemDirectoryHandle): Promise<File[]> {
  const out: File[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    const entries = dir.values();
    for await (const entry of entries) {
      // Never open an ignored file or descend into an ignored folder (`.git`,
      // `node_modules`): the import discards them, and walking them is the slow part.
      if (isIgnoredImportPath(prefix ? `${prefix}/${entry.name}` : entry.name)) continue;
      if (entry.kind === "file") {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        Object.defineProperty(file, "webkitRelativePath", {
          value: `${handle.name}/${relPath}`,
          configurable: true,
        });
        out.push(file);
      } else if (entry.kind === "directory") {
        const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        await walk(entry as FileSystemDirectoryHandle, subPrefix);
      }
    }
  };
  await walk(handle, "");
  return out;
}
