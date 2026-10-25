// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  });
  await flush();

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
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  });
  await flush();

  expect(nameInput().value).toBe("New");
  expect(document.body.textContent).toContain("Name is empty.");
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});
