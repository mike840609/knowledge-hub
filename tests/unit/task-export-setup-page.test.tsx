// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskExportSetup } from "@/components/task-knowledge/task-export-setup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const binding = { bindingId: "b1", label: "work laptop", status: "ACTIVE" as const, hasActiveCredential: true, createdAt: "2026-11-05T00:00:00Z" };

async function issueToken() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ bindingId: "b1", token: "khx_secret" }), { status: 201 })));
  act(() => root.render(createElement(TaskExportSetup, { workspaceId: "w1", bindings: [binding] })));
  const rotate = [...container.querySelectorAll("button")].find((b) => b.textContent === "Rotate token")!;
  await act(async () => { rotate.click(); });
}

describe("the Task export setup page", () => {
  it("says another machine takes another binding, and that rotating stops the machine using the token", () => {
    act(() => root.render(createElement(TaskExportSetup, { workspaceId: "w1", bindings: [binding] })));
    expect(container.textContent).toContain("One binding per machine");
    expect(container.textContent).toContain("rotating a token stops the machine that uses it");
  });

  it("shows one setup line with the token in it, and no separate token field", async () => {
    await issueToken();
    const line = container.querySelector("pre")!.textContent!;
    expect(line.startsWith("npm install -g ")).toBe(true);
    expect(line).toContain("knowledge-hub configure --hub-url");
    expect(line).toContain("--binding-id b1 --token khx_secret");
    expect(line).not.toContain("hidden prompt");
    expect(container.querySelector('input[aria-label="Export token"]')).toBeNull();
    expect(container.textContent).toContain("Treat this line as a secret");
  });

  it("copies exactly the setup line from the code block's own button", async () => {
    await issueToken();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const line = container.querySelector("pre")!.textContent!;
    const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]')!;
    await act(async () => { copy.click(); });
    expect(writeText).toHaveBeenCalledWith(line);
    expect(container.textContent).toContain("Copied");
  });

  it("says so when the clipboard refuses, leaving the line on the page to copy by hand", async () => {
    await issueToken();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]')!;
    await act(async () => { copy.click(); });
    expect(container.textContent).toContain("Could not copy");
    expect(container.querySelector("pre")!.textContent).toContain("--token khx_secret");
  });
});
