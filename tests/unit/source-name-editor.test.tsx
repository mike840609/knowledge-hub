// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function titleButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('button[title="Rename source"]')!;
}

async function openEditor() {
  render();
  await act(async () => {
    titleButton().click();
  });
}

async function type(value: string) {
  await act(async () => {
    const element = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

async function blur() {
  await act(async () => {
    input().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("opens on click, sends the trimmed value on Enter, and refreshes", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await openEditor();
  expect(document.activeElement).toBe(input());
  await type("  Research Vault  ");
  await press("Enter");
  await flush();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/sources/source-1/rename", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ name: "Research Vault" }),
  }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(document.querySelector('input[aria-label="Source name"]')).toBeNull();
  expect(document.activeElement).toBe(titleButton());
  expect(titleButton().textContent).toBe("Research Vault");
});

it("saves on blur", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await openEditor();
  await type("Blurred");
  await blur();
  await flush();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/sources/source-1/rename", expect.objectContaining({
    body: JSON.stringify({ name: "Blurred" }),
  }));
  expect(refresh).toHaveBeenCalledOnce();
});

it("sends one request when Enter is followed by blur", async () => {
  let resolveFetch!: (response: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  await openEditor();
  await type("Research Vault");
  await press("Enter");
  await blur();
  resolveFetch(new Response(null, { status: 204 }));
  await flush();

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("cancels on Escape without a request and returns focus to the title", async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  await openEditor();
  await type("Something else");
  await press("Escape");

  expect(fetchMock).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Old name");
  expect(document.activeElement).toBe(titleButton());
});

it("keeps the typed value, keeps focus, and reports a rejected rename", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Name is taken." } }), { status: 400 })));
  await openEditor();
  await type("New");
  await press("Enter");
  await flush();

  expect(input().value).toBe("New");
  expect(document.activeElement).toBe(input());
  expect(toast).toHaveBeenCalledWith({ message: "Name is taken.", tone: "danger" });
  expect(refresh).not.toHaveBeenCalled();
});
