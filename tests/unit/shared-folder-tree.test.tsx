// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...props }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
    void prefetch; // Next's own prop, not an attribute.
    return <a href={href} {...props}>{children}</a>;
  },
}));
import { SharedFolderTree, SharedFolderTreeButton, SharedFolderTreeScope } from "@/components/knowledge/shared-folder-tree";
import type { SharedTreeNode } from "@/modules/knowledge/application/document-share-service";

/**
 * The shared folder's tree (folder share spec §4): a rail beside the article, or behind a button in
 * the bar on a phone. Folders open and close; the folders on the read document's path start open.
 */
const nodes: SharedTreeNode[] = [
  { id: "welcome", parentId: null, kind: "DOCUMENT", name: "Welcome", documentId: "d-welcome", pageIcon: null },
  { id: "eng", parentId: null, kind: "FOLDER", name: "Engineering", documentId: null, pageIcon: null },
  { id: "setup", parentId: "eng", kind: "DOCUMENT", name: "Dev setup", documentId: "d-setup", pageIcon: "🛠" },
  { id: "runbooks", parentId: "eng", kind: "FOLDER", name: "Runbooks", documentId: null, pageIcon: null },
  { id: "deploy", parentId: "runbooks", kind: "DOCUMENT", name: "Deploy", documentId: "d-deploy", pageIcon: null },
  { id: "hr", parentId: null, kind: "FOLDER", name: "HR", documentId: null, pageIcon: null },
  { id: "empty", parentId: "hr", kind: "FOLDER", name: "Empty", documentId: null, pageIcon: null },
];

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** As the page draws it: the button in the bar, the tree beside it, one scope over both. */
const page = (tree: SharedTreeNode[], currentDocumentId: string | null) => <SharedFolderTreeScope><SharedFolderTreeButton /><SharedFolderTree token="tok" nodes={tree} currentDocumentId={currentDocumentId} folderName="Onboarding" /></SharedFolderTreeScope>;
const show = (currentDocumentId: string | null) => act(async () => root.render(page(nodes, currentDocumentId)));
const folder = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("nav button[aria-expanded]")].find(button => button.textContent?.trim() === name)!;
/** What a link is called aloud: its text without the icon beside it. */
const spoken = (element: Element) => { const copy = element.cloneNode(true) as Element; copy.querySelectorAll("[aria-hidden]").forEach(hidden => hidden.remove()); return copy.textContent?.trim(); };
const linkNames = () => [...container.querySelectorAll("nav a")].map(spoken);
const disclosure = () => container.querySelector<HTMLButtonElement>("button[aria-controls]")!;

describe("SharedFolderTree", () => {
  it("names itself by the folder, and links each visible document within the link", async () => {
    await show("d-setup");
    const nav = container.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Onboarding");
    expect(container.querySelector<HTMLAnchorElement>('a[aria-current="page"]')!.getAttribute("href")).toBe("/s/tok?d=d-setup");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("opens the folders on the read document's path and leaves the others closed", async () => {
    await show("d-deploy");
    expect(folder("Engineering").getAttribute("aria-expanded")).toBe("true");
    expect(folder("Runbooks").getAttribute("aria-expanded")).toBe("true");
    expect(folder("HR").getAttribute("aria-expanded")).toBe("false");
    expect(linkNames()).toEqual(["Welcome", "Dev setup", "Deploy"]);
  });

  it("opens and closes a folder", async () => {
    await show("d-welcome");
    expect(linkNames()).toEqual(["Welcome"]);
    await act(async () => folder("Engineering").click());
    expect(folder("Engineering").getAttribute("aria-expanded")).toBe("true");
    expect(linkNames()).toEqual(["Welcome", "Dev setup"]);
    await act(async () => folder("Engineering").click());
    expect(linkNames()).toEqual(["Welcome"]);
  });

  it("says an open folder with nothing in it is empty", async () => {
    await show("d-welcome");
    await act(async () => folder("HR").click());
    await act(async () => folder("Empty").click());
    expect(container.querySelector("nav")!.textContent).toContain("Empty folder");
  });

  it("opens the path to a document reached some other way (an in-folder link), keeping what the reader opened", async () => {
    await show("d-welcome");
    await act(async () => folder("HR").click());
    await show("d-deploy");
    expect(folder("Runbooks").getAttribute("aria-expanded")).toBe("true");
    expect(folder("HR").getAttribute("aria-expanded")).toBe("true");
  });

  it("lists nothing but a note when the folder is empty", async () => {
    await act(async () => root.render(page([], null)));
    expect(container.querySelector("nav")!.textContent).toContain("Empty folder");
  });
});

describe("on a phone, the tree is behind a button in the bar", () => {
  it("is a disclosure button naming what it shows", async () => {
    await show("d-setup");
    const button = disclosure();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(container.querySelector("nav")!.id);
    expect(button.textContent).toContain("Folder contents");
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on Escape and gives focus back to its button", async () => {
    await show("d-setup");
    await act(async () => disclosure().click());
    const link = container.querySelector<HTMLAnchorElement>("nav a")!;
    link.focus();
    await act(async () => { link.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(disclosure());
  });

  it("closes on Escape while focus is still on its button", async () => {
    await show("d-setup");
    disclosure().focus();
    await act(async () => disclosure().click());
    await act(async () => { disclosure().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on a press outside it, and stays open on a press inside it", async () => {
    await show("d-setup");
    await act(async () => disclosure().click());
    await act(async () => { container.querySelector("nav")!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(disclosure().getAttribute("aria-expanded")).toBe("true");
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes once a document is chosen", async () => {
    await show("d-setup");
    await act(async () => disclosure().click());
    const link = [...container.querySelectorAll<HTMLAnchorElement>("nav a")].find(candidate => candidate.textContent?.includes("Welcome"))!;
    link.addEventListener("click", event => event.preventDefault());
    await act(async () => link.click());
    expect(disclosure().getAttribute("aria-expanded")).toBe("false");
  });
});
