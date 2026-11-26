// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentMetaContext, DocumentMetaSlot, ReadOnlyBadge } from "@/components/knowledge/document-meta";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => children }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ""; });

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

it("says Read only as a badge and keeps the explanation out of sight until asked", async () => {
  const { host, root } = await mount(<ReadOnlyBadge syncHref="/w/w1/sources/s1/update" />);
  const badge = host.querySelector("button")!;
  expect(badge.textContent).toBe("Read only");
  expect(document.body.textContent).not.toContain("Edit the file in your folder");
  await act(async () => root.unmount());
});

it("opens the explanation, with its link, from the keyboard-reachable button", async () => {
  const { host, root } = await mount(<ReadOnlyBadge syncHref="/w/w1/sources/s1/update" />);
  const badge = host.querySelector<HTMLButtonElement>("button")!;
  await act(async () => badge.click());
  const popup = document.body.querySelector("[role=dialog]");
  expect(popup?.textContent).toContain("Edit the file in your folder, then update from folder");
  expect(popup?.querySelector("a")?.getAttribute("href")).toBe("/w/w1/sources/s1/update");
  expect(badge.getAttribute("aria-expanded")).toBe("true");
  // The dialog has a name.
  const labelledBy = popup?.getAttribute("aria-labelledby");
  expect(labelledBy && document.getElementById(labelledBy)?.textContent).toBe("Read only");
  await act(async () => root.unmount());
});

it("names a source with no folder to update from", async () => {
  const { host, root } = await mount(<ReadOnlyBadge syncHref={null} />);
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.body.querySelector("[role=dialog] p")?.textContent).toBe("Managed by its source");
  await act(async () => root.unmount());
});

it("the slot draws the page's meta line and nothing without a page around it", async () => {
  const empty = await mount(<DocumentMetaSlot />);
  expect(empty.host.innerHTML).toBe("");
  await act(async () => empty.root.unmount());
  const context = { meta: { status: "ACTIVE" as const, updatedAt: new Date("2026-10-01T00:00:00.000Z"), readOnly: true, syncHref: null, linkSummary: "3 backlinks", onLinksClick: vi.fn() }, outline: { entries: [], activeSlug: null } };
  const { host, root } = await mount(<DocumentMetaContext.Provider value={context}><DocumentMetaSlot /></DocumentMetaContext.Provider>);
  expect(host.textContent).toContain("Read only");
  expect(host.textContent).toContain("Updated");
  expect(host.textContent).toContain("3 backlinks");
  await act(async () => root.unmount());
});

it("draws nothing when the page keeps the meta line in its header (no context)", async () => {
  const { host, root } = await mount(<DocumentMetaContext.Provider value={null}><DocumentMetaSlot /></DocumentMetaContext.Provider>);
  expect(host.innerHTML).toBe("");
  await act(async () => root.unmount());
});
