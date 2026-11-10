import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Hub's share reader, `/w/<ws>/shares/<token>` (named-recipient share spec, "Where a NAMED share
 * is read"): the caller's own shell only, judged as `/s/<token>` is, one counted read per visit, and
 * the recipient's Inbox entry cleared.
 */
const fixture = vi.hoisted(() => ({ read: vi.fn(), markEventRead: vi.fn() }));
vi.mock("@/server/share-read", () => ({ getSharedForViewer: fixture.read }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "reader" } }, personalWorkspace: { id: "mine" } }),
    reviews: { markEventRead: fixture.markEventRead },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => { throw new Error(`redirect:${destination}`); },
  notFound: () => { throw new Error("notFound"); },
}));
import HubSharePage, { generateMetadata } from "@/app/w/[workspaceId]/shares/[token]/page";
import { SharedFolderPage } from "@/app/s/[token]/shared-folder-page";

const inFolder = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
const props = (workspaceId = "mine", d?: string) => ({ params: Promise.resolve({ workspaceId, token: "tok" }), searchParams: Promise.resolve(d === undefined ? {} : { d }) });
const documentView = { kind: "DOCUMENT", revisionId: "rev", title: "Named title", markdown: "Body", pageIcon: null, sharedByName: "Owner", updatedAt: new Date(0), expiresAt: null, audience: "NAMED", linkId: "link-1" };
const folderView = { kind: "FOLDER", rootName: "Folder", tree: [], sharedByName: "Owner", expiresAt: null, audience: "NAMED", linkId: "link-2",
  document: { ...documentView, documentId: inFolder, path: [], links: [] } };

/** Every element in a rendered tree, so a test can find the one it asks about. */
function elements(node: unknown): ReactElement[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: unknown }).children;
  return [node, ...(Array.isArray(children) ? children : [children]).flatMap(elements)];
}

beforeEach(() => {
  fixture.read.mockReset().mockResolvedValue(documentView);
  fixture.markEventRead.mockReset().mockResolvedValue(undefined);
});

describe("/w/:ws/shares/:token", () => {
  it("reads the share as the signed-in reader and draws it with its review panel", async () => {
    const page = await HubSharePage(props());
    expect(fixture.read).toHaveBeenCalledWith("tok", "reader", undefined);
    const panel = elements(page).find((element) => (element.props as { token?: string }).token === "tok");
    expect(panel?.props).toMatchObject({ token: "tok", revisionId: "rev", markdown: "Body", signInHref: "/w/mine/shares/tok" });
  });

  it("clears the reader's Inbox entry for the link", async () => {
    await HubSharePage(props());
    expect(fixture.markEventRead).toHaveBeenCalledWith({ identity: { id: "reader" } }, "shared:link-1");
  });

  it("still opens when the Inbox entry cannot be cleared", async () => {
    fixture.markEventRead.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(HubSharePage(props())).resolves.toBeTruthy();
    warn.mockRestore();
  });

  it("marks nothing for a read that names no link", async () => {
    fixture.read.mockResolvedValue({ ...documentView, audience: "LINK", linkId: undefined });
    await HubSharePage(props());
    expect(fixture.markEventRead).not.toHaveBeenCalled();
  });

  it("is not available when the share does not open for this reader", async () => {
    fixture.read.mockResolvedValue(null);
    await expect(HubSharePage(props())).rejects.toThrow("notFound");
    expect(fixture.markEventRead).not.toHaveBeenCalled();
    expect(await generateMetadata(props())).toMatchObject({ title: "Link not available" });
  });

  it("titles the page only from a read that opened", async () => {
    expect(await generateMetadata(props())).toMatchObject({ title: "Named title", robots: { index: false, follow: false } });
  });

  it("sends a reader on another Workspace's path to their own, reading nothing", async () => {
    await expect(HubSharePage(props("someone-else"))).rejects.toThrow("redirect:/w/mine/shares/tok");
    await expect(HubSharePage(props("someone-else", inFolder))).rejects.toThrow(`redirect:/w/mine/shares/tok?d=${inFolder}`);
    expect(fixture.read).not.toHaveBeenCalled();
    expect(await generateMetadata(props("someone-else"))).toMatchObject({ title: "Link not available" });
  });

  it("refuses a malformed `?d=` before reading", async () => {
    await expect(HubSharePage(props("mine", "x"))).rejects.toThrow("notFound");
    expect(fixture.read).not.toHaveBeenCalled();
  });

  it("draws a folder through the folder page, its links kept inside the Hub reader", async () => {
    fixture.read.mockResolvedValue(folderView);
    const page = await HubSharePage(props("mine", inFolder));
    expect(fixture.read).toHaveBeenCalledWith("tok", "reader", inFolder);
    expect(isValidElement(page) && page.type).toBe(SharedFolderPage);
    expect((page as ReactElement).props).toMatchObject({ token: "tok", platformEntry: null, pagePath: "/w/mine/shares/tok", signInHref: `/w/mine/shares/tok?d=${inFolder}` });
    expect(fixture.markEventRead).toHaveBeenCalledWith({ identity: { id: "reader" } }, "shared:link-2");
  });
});
