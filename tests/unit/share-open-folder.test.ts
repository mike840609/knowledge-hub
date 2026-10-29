import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Open in Knowledge Hub" from a shared page (folder share spec §4): a folder page passes the
 * document being read as `?d=`; `/open` re-checks it is reachable through the link, else opens the
 * landing document, and hands that id to `sharePlatformDestination`, which grants nothing.
 */
const fixture = vi.hoisted(() => ({
  available: vi.fn(),
  landing: vi.fn(),
  destination: vi.fn(),
  link: undefined as unknown,
}));
vi.mock("@/server/share-read", () => ({ isSharedAvailable: fixture.available, sharedLandingDocumentId: fixture.landing }));
vi.mock("@/server/share-platform-destination", () => ({ sharePlatformDestination: fixture.destination }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: { userId: "reader" }, personalWorkspace: { id: "personal" } }),
    unitOfWork: { run: async (work: (repositories: unknown) => unknown) => work({ shareLinks: { findByToken: async () => fixture.link } }) },
    queries: {},
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => { throw new Error(`redirect:${destination}`); },
  notFound: () => { throw new Error("notFound"); },
}));
import OpenSharedDocument from "@/app/s/[token]/open/page";

const inFolder = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
const landing = "0192f3a4-5b6c-7d8e-9f01-000000000001";
const open = (d?: string | string[]) => OpenSharedDocument({ params: Promise.resolve({ token: "tok" }), searchParams: Promise.resolve(d === undefined ? {} : { d }) });
const folderLink = { target: { kind: "FOLDER", folderNodeId: "folder" } };
const documentLink = { target: { kind: "DOCUMENT", documentId: "linked-doc" } };

beforeEach(() => {
  fixture.available.mockReset().mockResolvedValue(true);
  fixture.landing.mockReset().mockResolvedValue(landing);
  fixture.destination.mockReset().mockImplementation(async (_caller: unknown, documentId: string) => `/w/ws/knowledge/src/${documentId}`);
  fixture.link = folderLink;
});

describe("/s/:token/open for a folder link", () => {
  it("opens the document being read when it is reachable through the link", async () => {
    await expect(open(inFolder)).rejects.toThrow(`redirect:/w/ws/knowledge/src/${inFolder}`);
    expect(fixture.available).toHaveBeenCalledWith("tok", inFolder);
    expect(fixture.destination).toHaveBeenCalledWith({ userId: "reader" }, inFolder, "personal", {});
  });

  it("opens the landing document when the one asked for is no longer reachable", async () => {
    fixture.available.mockImplementation(async (_token: string, documentId?: string) => documentId === undefined);
    await expect(open(inFolder)).rejects.toThrow(`redirect:/w/ws/knowledge/src/${landing}`);
    expect(fixture.destination).toHaveBeenCalledWith({ userId: "reader" }, landing, "personal", {});
  });

  it("opens the landing document without `?d=`", async () => {
    await expect(open()).rejects.toThrow(`redirect:/w/ws/knowledge/src/${landing}`);
  });

  it("lands in the reader's own home when the folder holds no document", async () => {
    fixture.landing.mockResolvedValue(null);
    await expect(open()).rejects.toThrow("redirect:/w/personal/home");
    expect(fixture.destination).not.toHaveBeenCalled();
  });

  it.each(["x", "", inFolder.toUpperCase(), [inFolder, inFolder]])("refuses a malformed `?d=` %j as not available, before reading anything", async (d) => {
    await expect(open(d)).rejects.toThrow("notFound");
    expect(fixture.available).not.toHaveBeenCalled();
  });

  it("is not available when the link itself does not open", async () => {
    fixture.available.mockResolvedValue(false);
    await expect(open(inFolder)).rejects.toThrow("notFound");
    expect(fixture.destination).not.toHaveBeenCalled();
  });
});

describe("/s/:token/open for a document link", () => {
  beforeEach(() => { fixture.link = documentLink; });

  it("opens its document exactly as before when there is no `?d=`", async () => {
    await expect(open()).rejects.toThrow("redirect:/w/ws/knowledge/src/linked-doc");
    expect(fixture.available.mock.calls).toEqual([["tok"]]);
  });

  it("refuses any `?d=`, even a well-formed one", async () => {
    await expect(open(inFolder)).rejects.toThrow("notFound");
    expect(fixture.destination).not.toHaveBeenCalled();
  });
});
