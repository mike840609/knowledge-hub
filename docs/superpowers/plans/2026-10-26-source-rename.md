# Source rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader rename a source's display label in place, from the detail header or the source actions menu, without touching the folder tree, documents, sync, or links.

**Architecture:** A thin HTTP route calls a new `SourceApplicationService.renameSource` command, which validates the name, locks the source and workspace, and writes `knowledge_sources.name`. The detail header gets a small client editor (Enter/blur saves, Esc cancels); the existing lifecycle menu gets a “Rename source” item that opens a small dialog. Both use one fetch helper.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, MariaDB (`mariadb`), Vitest (node + jsdom), Base UI dialog/menu primitives.

**Spec:** `docs/superpowers/specs/2026-10-26-source-rename-design.md`

## Global Constraints

- Rename only `knowledge_sources.name`; never the tree root, documents, shares, or URLs.
- Trim the value; accept 1–512 characters; duplicates are allowed.
- Never bump `sync_version`.
- No schema migration, no audit event.
- Keep the `/update` import page out of this feature.
- Follow the existing error envelope `{ error: { code, message } }`; `VALIDATION_ERROR` is 400, `SOURCE_NOT_FOUND` and `WORKSPACE_ACCESS_DENIED` are 404.

## Review Focus

- A name with leading/trailing spaces persists trimmed, not raw. (Task 1 test)
- A source renamed twice, or two sources renamed to the same label, are both accepted. (Task 1 test)
- Esc cancels without a request; Enter and blur never send the same rename twice. (Task 3 test)
- A rejected rename keeps the typed value on screen and reports the server message. (Tasks 3 and 4 tests)
- Renaming an archived source changes only the label: status and `sync_version` stay. (Task 1 test)

---

## File Structure

- Modify `src/infrastructure/database/mariadb/repositories/sources.ts` — `updateName`.
- Modify `src/modules/sources/application/source-version-guard.ts` — `renameSource` + validation.
- Create `src/app/api/sources/[sourceId]/rename/route.ts` — HTTP adapter.
- Modify `src/components/shell/page-header.tsx` — accept a React node title.
- Create `src/components/sources/rename-source-request.ts` — shared fetch helper.
- Create `src/components/sources/source-name-editor.tsx` — header inline editor.
- Create `src/components/sources/rename-source-dialog.tsx` — menu dialog.
- Modify `src/components/sources/source-lifecycle-actions.tsx` — menu item.
- Modify `src/components/sources/source-detail.tsx` — use the editor in the header.

---

### Task 1: Persist a renamed source

**Files:**
- Modify: `src/infrastructure/database/mariadb/repositories/sources.ts` (after `updateStatus`)
- Modify: `src/modules/sources/application/source-version-guard.ts:52-56, 156-166`
- Test: `tests/integration/phase1-lifecycle.test.ts` (new `describe` after the existing source lifecycle suite)

**Interfaces:**
- Produces: `MariaDbSourceRepository.updateName(sourceId: string, name: string, actorId: string): Promise<void>`
- Produces: `SourceApplicationService.renameSource(caller: CallerContext, sourceId: string, name: string): Promise<void>`
- Produces: `SourceLifecycleCommands` also declares `renameSource`.
- Consumes: `syncCallerIdentity`, `lockWorkspaceForMutation`, `SourceNotFoundError`, `ValidationError`, `MAX_FOLDER_NAME_LENGTH`.

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/integration/phase1-lifecycle.test.ts`, after the existing source lifecycle `describe`:

```ts
describe("source rename", () => {
  it("trims the name, persists it, and leaves status and sync_version alone", async () => {
    const scope = await setupLifecycleScope();
    const { sources } = lifecycleServices();
    const caller = callerFromIdentity(owner);

    await sources.renameSource(caller, scope.managedSourceId, "  Research Vault  ");

    const [row] = await pool.query<{ name: string; status: string; sync_version: number }[]>(
      "SELECT name, status, sync_version FROM knowledge_sources WHERE id = ?",
      [scope.managedSourceId],
    );
    expect(row).toMatchObject({ name: "Research Vault", status: "ACTIVE", sync_version: 0 });

    await sources.renameSource(caller, scope.managedSourceId, "Research Vault");
    await sources.renameSource(caller, scope.hubSourceId, "Research Vault");
    const names = await pool.query<{ name: string }[]>(
      "SELECT name FROM knowledge_sources WHERE id IN (?, ?) ORDER BY name",
      [scope.managedSourceId, scope.hubSourceId],
    );
    expect(names.map((entry) => entry.name)).toEqual(["Research Vault", "Research Vault"]);
  });

  it("rejects an empty or over-long name", async () => {
    const scope = await setupLifecycleScope();
    const { sources } = lifecycleServices();
    const caller = callerFromIdentity(owner);

    await expect(sources.renameSource(caller, scope.managedSourceId, "   ")).rejects.toBeInstanceOf(ValidationError);
    await expect(sources.renameSource(caller, scope.managedSourceId, "x".repeat(513))).rejects.toBeInstanceOf(ValidationError);
    const [row] = await pool.query<{ name: string }[]>("SELECT name FROM knowledge_sources WHERE id = ?", [scope.managedSourceId]);
    expect(row?.name).toBe("Managed Source");
  });

  it("refuses a caller outside the workspace and keeps the name", async () => {
    const scope = await setupLifecycleScope();
    const { sources } = lifecycleServices();
    const stranger = callerFromIdentity(outsider);

    await expect(sources.renameSource(stranger, scope.managedSourceId, "Hijacked")).rejects.toBeInstanceOf(WorkspaceAccessDeniedError);
    const [row] = await pool.query<{ name: string }[]>("SELECT name FROM knowledge_sources WHERE id = ?", [scope.managedSourceId]);
    expect(row?.name).toBe("Managed Source");
  });

  it("renames an archived source without restoring it", async () => {
    const scope = await setupLifecycleScope();
    const { sources } = lifecycleServices();
    const caller = callerFromIdentity(owner);

    await sources.archiveSource(caller, scope.managedSourceId);
    await sources.renameSource(caller, scope.managedSourceId, "Archived Vault");
    const [row] = await pool.query<{ name: string; status: string }[]>(
      "SELECT name, status FROM knowledge_sources WHERE id = ?",
      [scope.managedSourceId],
    );
    expect(row).toMatchObject({ name: "Archived Vault", status: "ARCHIVED" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:integration`
Expected: FAIL — `sources.renameSource is not a function` (the suite provisions its own database; running `npx vitest` directly bypasses that provisioning).

- [ ] **Step 3: Implement `updateName` in the repository**

Add after `updateStatus` in `src/infrastructure/database/mariadb/repositories/sources.ts`:

```ts
async updateName(sourceId: string, name: string, actorId: string): Promise<void> {
  const result = await this.connection.query(
    "UPDATE knowledge_sources SET name = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
    [name, actorId, sourceId],
  );
  if (affectedRows(result) !== 1) throw new IntegrityViolationError("Source name could not be updated.");
}
```

- [ ] **Step 4: Implement `renameSource` in the service**

In `src/modules/sources/application/source-version-guard.ts`:

1. Add `renameSource(caller: CallerContext, sourceId: string, name: string): Promise<void>;` to `SourceLifecycleCommands`.
2. Import `MAX_FOLDER_NAME_LENGTH` from `@/modules/knowledge/domain/tree-rules` and `ValidationError` from `@/modules/knowledge/domain/errors`.
3. Add next to `archiveSource`:

```ts
async renameSource(caller: CallerContext, sourceId: string, name: string): Promise<void> {
  const next = normalizedSourceName(name);
  await this.unitOfWork.run(async (repositories) => {
    await syncCallerIdentity(repositories.users, caller);
    const source = await repositories.sources.lockById(sourceId);
    if (!source) throw new SourceNotFoundError();
    await lockWorkspaceForMutation(repositories, caller, source.workspaceId, "source-import");
    if (source.name === next) return;
    await repositories.sources.updateName(sourceId, next, caller.identity.id);
  });
}
```

4. Add the module-level helper next to the other module functions, outside the class:

```ts
function normalizedSourceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new ValidationError(`Source name must be between 1 and ${MAX_FOLDER_NAME_LENGTH} characters.`);
  }
  return trimmed;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS — the four new tests included, and the full suite still green.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/database/mariadb/repositories/sources.ts src/modules/sources/application/source-version-guard.ts tests/integration/phase1-lifecycle.test.ts
git commit -m "feat(sources): persist a renamed source"
```

---

### Task 2: Rename HTTP route

**Files:**
- Create: `src/app/api/sources/[sourceId]/rename/route.ts`
- Test: `tests/unit/source-rename-route.test.ts`

**Interfaces:**
- Consumes: `workspaceHttp`, `requestFields`, `services.sources.renameSource`.
- Produces: `POST /api/sources/[sourceId]/rename`, body `{ "name": string }`, answer 204.

- [ ] **Step 1: Write the failing route tests**

Create `tests/unit/source-rename-route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { SourceNotFoundError, ValidationError } from "@/modules/knowledge/domain/errors";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { POST } from "@/app/api/sources/[sourceId]/rename/route";

type Services = ReturnType<typeof ApplicationServicesFn>;

const caller = callerFromIdentity({ id: "0199f600-0000-7000-8000-000000000001", emp_id: "REN-1", name: "R", org_code: "HRSD" });
const sourceId = "0199f600-0000-7000-8000-000000000002";
const context = { params: Promise.resolve({ sourceId }) };

function services(renameSource: (caller: unknown, sourceId: string, name: string) => Promise<void>): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    sources: { renameSource },
  } as unknown as Services;
}

function request(body: unknown): Request {
  return new Request(`http://127.0.0.1/api/sources/${sourceId}/rename`, { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/sources/[sourceId]/rename", () => {
  it("passes the name through and answers 204", async () => {
    const renameSource = vi.fn(async () => {});
    vi.mocked(applicationServices).mockReturnValue(services(renameSource));

    const response = await POST(request({ name: "Research Vault" }), context);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(renameSource).toHaveBeenCalledWith(caller, sourceId, "Research Vault");
  });

  it("rejects a body without a string name", async () => {
    const renameSource = vi.fn(async () => {});
    vi.mocked(applicationServices).mockReturnValue(services(renameSource));

    const response = await POST(request({ name: 42 }), context);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(renameSource).not.toHaveBeenCalled();
  });

  it("maps validation and missing-source errors", async () => {
    vi.mocked(applicationServices).mockReturnValue(services(async () => { throw new ValidationError("Too long."); }));
    expect((await POST(request({ name: "x" }), context)).status).toBe(400);

    vi.mocked(applicationServices).mockReturnValue(services(async () => { throw new SourceNotFoundError(); }));
    const missing = await POST(request({ name: "x" }), context);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/source-rename-route.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/sources/[sourceId]/rename/route.ts`:

```ts
import { requestFields, workspaceHttp } from "@/server/workspace-http";

export async function POST(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    const { name } = await requestFields(request, ["name"]);
    await services.sources.renameSource(caller, (await context.params).sourceId, name);
  }, 204);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/source-rename-route.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sources/[sourceId]/rename/route.ts tests/unit/source-rename-route.test.ts
git commit -m "feat(sources): add the rename endpoint"
```

---

### Task 3: Inline rename in the detail header

**Files:**
- Create: `src/components/sources/rename-source-request.ts`
- Create: `src/components/sources/source-name-editor.tsx`
- Modify: `src/components/shell/page-header.tsx:9-27`
- Modify: `src/components/sources/source-detail.tsx:16-19`
- Test: `tests/unit/source-name-editor.test.tsx`

**Interfaces:**
- Produces: `requestSourceRename(sourceId: string, name: string): Promise<void>` — throws an `Error` carrying the server message on a non-2xx response.
- Produces: `<SourceNameEditor sourceId={string} name={string} />`.
- Consumes: `useRouter().refresh`, `useToast()`.

- [ ] **Step 1: Write the failing editor tests**

Create `tests/unit/source-name-editor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));

import { SourceNameEditor } from "@/components/sources/source-name-editor";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(name = "Old name") {
  act(() => root.render(<SourceNameEditor sourceId="source-1" name={name} />));
}

function input(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('input[aria-label="Source name"]');
  if (!element) throw new Error("the name input is not mounted");
  return element;
}

async function openEditor() {
  render();
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Rename Old name"]')!.click();
  });
}

it("opens on click, sends the trimmed value on Enter, and refreshes", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await openEditor();
  await act(async () => {
    const element = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(element, "  Research Vault  ");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/sources/source-1/rename", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ name: "Research Vault" }),
  }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(document.querySelector('input[aria-label="Source name"]')).toBeNull();
});

it("cancels on Escape without a request", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await openEditor();
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Old name");
});

it("keeps the typed value and reports a rejected rename", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Name is taken." } }), { status: 400 })));
  await openEditor();
  await act(async () => {
    const element = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(element, "New");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(input().value).toBe("New");
  expect(toast).toHaveBeenCalledWith({ message: "Name is taken.", tone: "danger" });
  expect(refresh).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/source-name-editor.test.tsx`
Expected: FAIL — cannot resolve `@/components/sources/source-name-editor`.

- [ ] **Step 3: Implement the shared request helper**

Create `src/components/sources/rename-source-request.ts`:

```ts
export async function requestSourceRename(sourceId: string, name: string): Promise<void> {
  const response = await fetch(`/api/sources/${sourceId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  throw new Error(body?.error?.message ?? "Could not rename the source.");
}
```

- [ ] **Step 4: Implement `SourceNameEditor`**

Create `src/components/sources/source-name-editor.tsx`. Requirements:

- Display mode: a `<button type="button" aria-label={\`Rename ${name}\`}>` showing the name, with truncation and the `kh-focus-ring` class.
- Edit mode: `<input aria-label="Source name" autoFocus>` pre-filled with the name and fully selected.
- Enter and blur both call one `commit()`; guard with a `useRef` boolean so Enter followed by blur sends one request.
- `commit()` trims; if empty, restores the original name and closes; if unchanged, closes without a request; otherwise calls `requestSourceRename`, closes, and `router.refresh()`.
- On failure it calls `toast({ message, tone: "danger" })`, keeps the input mounted with the typed value, and refocuses it.
- Esc restores the original name and closes without a request.
- Disable the input while the request is in flight.

- [ ] **Step 5: Let `PageHeader` accept a node title**

In `src/components/shell/page-header.tsx`, change `title: string` to `title: ReactNode`. No caller changes.

- [ ] **Step 6: Use the editor on the source detail header**

In `src/components/sources/source-detail.tsx`, import `SourceNameEditor` and replace `title={source.name}` with:

```tsx
title={<SourceNameEditor sourceId={source.id} name={source.name} />}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/source-name-editor.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 8: Commit**

```bash
git add src/components/sources/rename-source-request.ts src/components/sources/source-name-editor.tsx src/components/shell/page-header.tsx src/components/sources/source-detail.tsx tests/unit/source-name-editor.test.tsx
git commit -m "feat(sources): rename a source in the detail header"
```

---

### Task 4: Rename from the source actions menu

**Files:**
- Create: `src/components/sources/rename-source-dialog.tsx`
- Modify: `src/components/sources/source-lifecycle-actions.tsx`
- Test: `tests/unit/source-rename-dialog.test.tsx`

**Interfaces:**
- Produces: `<RenameSourceDialog open={boolean} onOpenChange={(open: boolean) => void} sourceId={string} name={string} />`.
- Consumes: `requestSourceRename`, `useRouter().refresh`, the dialog classes from `@/components/ui/dialog`.

- [ ] **Step 1: Write the failing dialog tests**

Create `tests/unit/source-rename-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RenameSourceDialog } from "@/components/sources/rename-source-dialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(onOpenChange = vi.fn()) {
  act(() => root.render(<RenameSourceDialog open onOpenChange={onOpenChange} sourceId="source-1" name="Old name" />));
  return onOpenChange;
}

function nameInput(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('input[aria-label="Source name"]');
  if (!element) throw new Error("the name input is not mounted");
  return element;
}

it("submits the trimmed name and closes", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const onOpenChange = render();

  await act(async () => {
    const element = nameInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(element, "  Research Vault  ");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  });

  expect(fetchMock).toHaveBeenCalledWith("/api/sources/source-1/rename", expect.objectContaining({ body: JSON.stringify({ name: "Research Vault" }) }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("keeps the dialog open with the typed value and the server message on failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Name is empty." } }), { status: 400 })));
  const onOpenChange = render();

  await act(async () => {
    const element = nameInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(element, "New");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  });

  expect(nameInput().value).toBe("New");
  expect(document.body.textContent).toContain("Name is empty.");
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --config vitest.config.ts tests/unit/source-rename-dialog.test.tsx`
Expected: FAIL — cannot resolve `@/components/sources/rename-source-dialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/components/sources/rename-source-dialog.tsx`, mirroring `src/components/knowledge/folder-name-dialog.tsx`:

- Base UI `Dialog.Root` with `open` / `onOpenChange`, `Dialog.Portal`, `dialogBackdropClasses()`, `dialogPopupClasses("w-[min(26rem,92vw)]")`.
- Title “Rename source”, description “Only the name changes; its place and what's inside stay as they are.”
- A `<form>` with a labeled `Input aria-label="Source name"`, `autoComplete="off"`, `aria-invalid` and `aria-describedby` when there is a problem.
- Submit trims; an empty value shows “Enter a name.” without a request; otherwise calls `requestSourceRename`, then `onOpenChange(false)` and `router.refresh()`.
- On failure show the message in a `role="alert"` paragraph and keep the dialog open with the typed value.
- Reset the input to `name` and clear the problem each time `open` becomes true.
- Cancel and submit buttons disabled while busy; submit label “Renaming…”.

- [ ] **Step 4: Wire it into the lifecycle menu**

In `src/components/sources/source-lifecycle-actions.tsx`:

- Import `RenameSourceDialog`.
- Add `const [renameOpen, setRenameOpen] = useState(false);`.
- Inside `MenuContent`, before the archive/restore item:

```tsx
<MenuItem onClick={() => setRenameOpen(true)}>Rename source</MenuItem>
```

- Render next to the `ConfirmDialog`:

```tsx
<RenameSourceDialog open={renameOpen} onOpenChange={setRenameOpen} sourceId={sourceId} name={sourceName} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --config vitest.config.ts tests/unit/source-rename-dialog.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 6: Manual smoke**

Run `npm run dev`, open a source, and check:

- The detail header name is clickable, Enter saves, Esc cancels.
- The `⋯` menu shows “Rename source” on both the list row and the detail header.
- After saving, the list, header, and breadcrumb show the new name.

- [ ] **Step 7: Commit**

```bash
git add src/components/sources/rename-source-dialog.tsx src/components/sources/source-lifecycle-actions.tsx tests/unit/source-rename-dialog.test.tsx
git commit -m "feat(sources): rename from the source actions menu"
```

---

## Final verification

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npx vitest run --config vitest.config.ts`
- [ ] `npm run test:integration`
- [ ] `npm run build`
- [ ] Manual smoke from Task 4, plus renaming an archived source from the list.
