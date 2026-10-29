// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedFolderView } from "@/modules/knowledge/application/document-share-service";

/**
 * The folder page as a reader moves through it (folder share spec §4): the panel is drawn afresh
 * for each document, but the tree beside it is the reader's, and what they opened stays open.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...props }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
    void prefetch;
    return <a href={href} {...props}>{children}</a>;
  },
}));
vi.mock("@/components/knowledge/save-share-button", () => ({ SaveShareButton: () => <button type="button">Save</button> }));
vi.mock("@/components/knowledge/shared-reading", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/knowledge/shared-reading")>();
  return {
    ...actual,
    SharedReading: ({ document, contentId }: { document: { title: string }; contentId?: string }) => <article id={contentId} tabIndex={contentId ? -1 : undefined}>{document.title}</article>,
    SharedByline: () => null,
    SharedFooter: () => <footer />,
  };
});
// A stand-in that, like the real panel, draws the page's bar (brand and actions) inside itself.
vi.mock("@/components/knowledge/shared-review-panel", () => ({
  SharedReviewPanel: ({ brand, actions, children }: { brand?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) => (
    <div data-review-panel=""><header>{brand}{actions}</header>{children}</div>
  ),
}));
import { SharedFolderPage } from "@/app/s/[token]/shared-folder-page";

const ids = { welcome: "0192f3a4-0000-7000-8000-000000000001", setup: "0192f3a4-0000-7000-8000-000000000002" };
const view = (documentId: string, title: string, path: { id: string; name: string }[]): SharedFolderView => ({
  kind: "FOLDER",
  folderName: "Onboarding",
  sharedByName: "Mike",
  expiresAt: new Date("2026-11-27T00:00:00Z"),
  tree: [
    { id: "n-welcome", parentId: null, kind: "DOCUMENT", name: "Welcome", documentId: ids.welcome, pageIcon: null },
    { id: "n-eng", parentId: null, kind: "FOLDER", name: "Engineering", documentId: null, pageIcon: null },
    { id: "n-setup", parentId: "n-eng", kind: "DOCUMENT", name: "Dev setup", documentId: ids.setup, pageIcon: null },
    { id: "n-hr", parentId: null, kind: "FOLDER", name: "HR", documentId: null, pageIcon: null },
    { id: "n-policy", parentId: "n-hr", kind: "DOCUMENT", name: "Policy", documentId: "0192f3a4-0000-7000-8000-000000000003", pageIcon: null },
  ],
  document: { documentId, revisionId: `rev-${documentId}`, title, markdown: title, pageIcon: null, sharedByName: "Mike", updatedAt: new Date(), expiresAt: new Date(), path, links: [] },
});

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

const show = (folder: SharedFolderView) => act(async () => root.render(<SharedFolderPage token="tok" folder={folder} platformEntry="/s/tok/open" signInHref="/sign-in" />));
const folderButton = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("nav button[aria-expanded]")].find(button => button.textContent?.trim() === name)!;

describe("the folder page's tree across documents", () => {
  it("keeps a folder the reader opened open when they read another document", async () => {
    await show(view(ids.welcome, "Welcome", []));
    expect(folderButton("HR").getAttribute("aria-expanded")).toBe("false");
    await act(async () => folderButton("HR").click());
    expect(folderButton("HR").getAttribute("aria-expanded")).toBe("true");

    await show(view(ids.setup, "Dev setup", [{ id: "n-eng", name: "Engineering" }]));
    expect(container.querySelector("article")!.textContent).toBe("Dev setup");
    expect(folderButton("HR").getAttribute("aria-expanded")).toBe("true");
    expect(folderButton("Engineering").getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the same tree element, so its scroll position stays where the reader left it", async () => {
    await show(view(ids.welcome, "Welcome", []));
    const nav = container.querySelector("nav[aria-label='Onboarding']")!;
    nav.scrollTop = 120;
    await show(view(ids.setup, "Dev setup", [{ id: "n-eng", name: "Engineering" }]));
    expect(container.querySelector("nav[aria-label='Onboarding']")).toBe(nav);
  });

  it("still puts the phone's tree button in the bar, beside the brand", async () => {
    await show(view(ids.welcome, "Welcome", []));
    const bar = container.querySelector("[data-review-panel] header")!;
    const button = [...bar.querySelectorAll("button")].find(candidate => candidate.textContent?.includes("Folder contents"))!;
    expect(button).toBeDefined();
    const nav = container.querySelector("nav[aria-label='Onboarding']")!;
    expect(button.getAttribute("aria-controls")).toBe(nav.id);
    expect(nav.classList.contains("max-sm:hidden")).toBe(true);
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(nav.classList.contains("max-sm:hidden")).toBe(false);
  });

  it("starts with a skip link to the reading column", async () => {
    await show(view(ids.welcome, "Welcome", []));
    const skip = container.querySelector<HTMLAnchorElement>("main > a")!;
    expect(skip.textContent).toBe("Skip to content");
    expect(skip.getAttribute("href")).toBe("#shared-content");
    expect(container.querySelector("#shared-content")!.getAttribute("tabindex")).toBe("-1");
  });

  it("marks the breadcrumb's last item as the location, leaving one current page in the tree", async () => {
    await show(view(ids.setup, "Dev setup", [{ id: "n-eng", name: "Engineering" }]));
    const crumbs = container.querySelector("nav[aria-label='Breadcrumb']")!;
    expect(crumbs.querySelector('[aria-current="location"]')!.textContent).toBe("Dev setup");
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Dev setup");
  });
});
