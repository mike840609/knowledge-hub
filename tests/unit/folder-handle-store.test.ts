// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectHandleFiles,
  forgetRememberedFolder,
  getRememberedFolderMeta,
  isDirectoryPickerSupported,
  loadRememberedHandle,
  rememberFolderHandle,
} from "@/components/imports/folder-handle-store";
import type {
  FileSystemDirectoryHandle,
  FileSystemFileHandle,
  FileSystemHandle,
} from "@/components/imports/folder-handle-store";

/**
 * The one-click re-sync reads the previously picked local folder without
 * opening a picker. The handle itself lives in IndexedDB (a File handle is
 * not serializable to localStorage); only the display meta lives there.
 * These tests fake both browser surfaces the module touches.
 */

type PermissionState = "granted" | "denied" | "prompt";

interface FakePermissions {
  query: PermissionState;
  request: PermissionState;
}

const META_KEY = (sourceId: string): string => `km:folder-handle:${sourceId}`;

function relativePathOf(file: File): string {
  const candidate = file as File & { webkitRelativePath?: string };
  return candidate.webkitRelativePath ?? file.name;
}

// --- Fake File System Access handles ----------------------------------------

type TestEntry =
  | { kind: "file"; name: string; content: string }
  | { kind: "directory"; name: string; children: TestEntry[] };

function makeFileHandle(
  name: string,
  content: string,
  permissions: FakePermissions,
): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    getFile: async () => new File([content], name, { type: "text/markdown" }),
    queryPermission: async () => permissions.query,
    requestPermission: async () => permissions.request,
  };
}

function makeDirHandle(
  name: string,
  children: TestEntry[],
  permissions: FakePermissions = { query: "granted", request: "granted" },
): FileSystemDirectoryHandle {
  async function* values(): AsyncIterableIterator<FileSystemHandle> {
    for (const child of children) {
      if (child.kind === "file") {
        yield makeFileHandle(child.name, child.content, permissions);
      } else {
        yield makeDirHandle(child.name, child.children, permissions);
      }
    }
  }
  return {
    kind: "directory",
    name,
    values,
    queryPermission: async () => permissions.query,
    requestPermission: async () => permissions.request,
  };
}

// --- Fake IndexedDB (in-memory, async like the real one) --------------------

interface MutableRequest<T> {
  result: T | undefined;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

function makeRequest<T>(): MutableRequest<T> {
  return { result: undefined, onsuccess: null, onerror: null };
}

function completeRequest<T>(request: MutableRequest<T>, result: T): void {
  request.result = result;
  request.onsuccess?.({} as Event);
}

class FakeObjectStore {
  constructor(
    private readonly map: Map<string, unknown>,
    private readonly done: () => void,
  ) {}

  put(value: unknown, key: string): IDBRequest<string> {
    const request = makeRequest<string>();
    queueMicrotask(() => {
      this.map.set(key, value);
      completeRequest(request, key);
      this.done();
    });
    return request as unknown as IDBRequest<string>;
  }

  get(key: string): IDBRequest<unknown> {
    const request = makeRequest<unknown>();
    queueMicrotask(() => {
      completeRequest(request, this.map.has(key) ? this.map.get(key) : undefined);
      this.done();
    });
    return request as unknown as IDBRequest<unknown>;
  }

  delete(key: string): IDBRequest<undefined> {
    const request = makeRequest<undefined>();
    queueMicrotask(() => {
      this.map.delete(key);
      completeRequest(request, undefined);
      this.done();
    });
    return request as unknown as IDBRequest<undefined>;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor(private readonly map: Map<string, unknown>) {}

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.map, () => this.oncomplete?.());
  }
}

class FakeDatabase {
  private readonly maps = new Map<string, Map<string, unknown>>();

  objectStoreNames = {
    contains: (name: string): boolean => this.maps.has(name),
  };

  createObjectStore(name: string): unknown {
    if (!this.maps.has(name)) this.maps.set(name, new Map());
    return {};
  }

  transaction(storeName: string): FakeTransaction {
    let map = this.maps.get(storeName);
    if (!map) {
      map = new Map();
      this.maps.set(storeName, map);
    }
    return new FakeTransaction(map);
  }

  close(): void {}
}

interface FakeIndexedDB {
  factory: IDBFactory;
  db: FakeDatabase;
}

function createFakeIndexedDB(): FakeIndexedDB {
  const db = new FakeDatabase();
  const factory = {
    open(): IDBOpenDBRequest {
      const request = {
        result: undefined as unknown as IDBDatabase,
        error: null,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onblocked: null as ((event: Event) => void) | null,
        onupgradeneeded: null as ((event: Event) => void) | null,
      };
      queueMicrotask(() => {
        request.result = db as unknown as IDBDatabase;
        request.onupgradeneeded?.({} as Event);
        request.onsuccess?.({} as Event);
      });
      return request as unknown as IDBOpenDBRequest;
    },
  };
  return { factory: factory as unknown as IDBFactory, db };
}

// --- Picker stub --------------------------------------------------------------

function stubPicker(): void {
  (window as unknown as { showDirectoryPicker?: () => Promise<unknown> }).showDirectoryPicker =
    async () => ({});
}

function unstubPicker(): void {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
}

describe("folder-handle-store", () => {
  let fake: FakeIndexedDB;

  beforeEach(() => {
    localStorage.clear();
    unstubPicker();
    fake = createFakeIndexedDB();
    vi.stubGlobal("indexedDB", fake.factory);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    unstubPicker();
  });

  it("reports picker support only when window.showDirectoryPicker is a function", () => {
    expect(isDirectoryPickerSupported()).toBe(false);
    stubPicker();
    expect(isDirectoryPickerSupported()).toBe(true);
  });

  it("returns null meta when nothing was remembered, and null on corrupt meta", () => {
    stubPicker();
    expect(getRememberedFolderMeta("src-1")).toBeNull();
    localStorage.setItem(META_KEY("src-1"), "not-json{{{");
    expect(getRememberedFolderMeta("src-1")).toBeNull();
    localStorage.setItem(META_KEY("src-1"), JSON.stringify({ rootName: 42 }));
    expect(getRememberedFolderMeta("src-1")).toBeNull();
  });

  it("rememberFolderHandle persists the meta with rootName and an ISO lastSyncAt", async () => {
    stubPicker();
    const handle = makeDirHandle("wiki", [{ kind: "file", name: "a.md", content: "# a" }]);
    await rememberFolderHandle("src-1", handle, "wiki");

    const meta = getRememberedFolderMeta("src-1");
    expect(meta).not.toBeNull();
    expect(meta?.rootName).toBe("wiki");
    expect(typeof meta?.lastSyncAt).toBe("string");
    expect(Number.isNaN(Date.parse(meta?.lastSyncAt ?? ""))).toBe(false);
  });

  it("loadRememberedHandle returns the stored handle and rootName when readable", async () => {
    stubPicker();
    const handle = makeDirHandle("wiki", [{ kind: "file", name: "a.md", content: "# a" }]);
    await rememberFolderHandle("src-1", handle, "wiki");

    const loaded = await loadRememberedHandle("src-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.rootName).toBe("wiki");
    expect(loaded?.handle.name).toBe("wiki");
    const files = await collectHandleFiles(loaded?.handle as FileSystemDirectoryHandle);
    expect(files.map((file) => file.name)).toEqual(["a.md"]);
  });

  it("loadRememberedHandle returns null when the picker is unsupported, even with stored data", async () => {
    stubPicker();
    const handle = makeDirHandle("wiki", [{ kind: "file", name: "a.md", content: "# a" }]);
    await rememberFolderHandle("src-1", handle, "wiki");

    unstubPicker();
    expect(isDirectoryPickerSupported()).toBe(false);
    expect(await loadRememberedHandle("src-1")).toBeNull();
  });

  it("loadRememberedHandle deletes the stale meta when the handle is gone from IndexedDB", async () => {
    stubPicker();
    // Meta without a stored handle: the IDB entry was lost or never written.
    localStorage.setItem(
      META_KEY("src-gone"),
      JSON.stringify({ rootName: "wiki", lastSyncAt: new Date().toISOString() }),
    );

    expect(await loadRememberedHandle("src-gone")).toBeNull();
    expect(getRememberedFolderMeta("src-gone")).toBeNull();
  });

  it("loadRememberedHandle asks for read permission once and returns null when denied", async () => {
    stubPicker();
    let requests = 0;
    const handle = makeDirHandle("wiki", [{ kind: "file", name: "a.md", content: "# a" }], {
      query: "denied",
      request: "denied",
    });
    const counting = {
      ...handle,
      requestPermission: async (): Promise<PermissionState> => {
        requests += 1;
        return "denied";
      },
    };
    await rememberFolderHandle("src-denied", counting, "wiki");

    expect(await loadRememberedHandle("src-denied")).toBeNull();
    expect(requests).toBe(1);
  });

  it("loadRememberedHandle recovers when the one requestPermission attempt is granted", async () => {
    stubPicker();
    const inner = makeDirHandle("wiki", [{ kind: "file", name: "a.md", content: "# a" }], {
      query: "prompt",
      request: "granted",
    });
    await rememberFolderHandle("src-prompt", inner, "wiki");

    const loaded = await loadRememberedHandle("src-prompt");
    expect(loaded?.rootName).toBe("wiki");
  });

  it("forgetRememberedFolder removes both entries and never throws when empty", async () => {
    stubPicker();
    const handle = makeDirHandle("wiki", [{ kind: "file", name: "a.md", content: "# a" }]);
    await rememberFolderHandle("src-1", handle, "wiki");
    await forgetRememberedFolder("src-1");

    expect(getRememberedFolderMeta("src-1")).toBeNull();
    expect(await loadRememberedHandle("src-1")).toBeNull();
    await expect(forgetRememberedFolder("src-missing")).resolves.toBeUndefined();
  });

  it("collectHandleFiles walks nested folders and prefixes webkitRelativePath with the root name", async () => {
    const handle = makeDirHandle("wiki", [
      { kind: "file", name: "top.md", content: "# top" },
      {
        kind: "directory",
        name: "docs",
        children: [
          { kind: "file", name: "a.md", content: "# a" },
          {
            kind: "directory",
            name: "deep",
            children: [{ kind: "file", name: "b.md", content: "# b" }],
          },
        ],
      },
    ]);

    const files = await collectHandleFiles(handle);
    expect(files).toHaveLength(3);
    const paths = files.map(relativePathOf).sort();
    expect(paths).toEqual(["wiki/docs/a.md", "wiki/docs/deep/b.md", "wiki/top.md"]);

    // selectFolder() in folder-import-form.tsx takes the first path segment as
    // rootName, so every collected path must start with the handle name.
    for (const file of files) {
      const full = relativePathOf(file);
      expect(full.slice(0, full.indexOf("/"))).toBe(handle.name);
    }
  });

  it("resolves null / no-ops instead of throwing when IndexedDB is unavailable", async () => {
    stubPicker();
    vi.stubGlobal("indexedDB", undefined);
    const handle = makeDirHandle("wiki", [{ kind: "file", name: "a.md", content: "# a" }]);
    await expect(rememberFolderHandle("src-1", handle, "wiki")).resolves.toBeUndefined();
    expect(await loadRememberedHandle("src-1")).toBeNull();
    await expect(forgetRememberedFolder("src-1")).resolves.toBeUndefined();
  });
});
