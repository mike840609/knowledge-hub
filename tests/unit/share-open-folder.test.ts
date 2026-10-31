import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Open in Knowledge Hub" from a shared page (folder share spec §4): the page asks the one read
 * projection where to go. A folder page passes the document being read as `?d=`; the service opens
 * it when it is still reachable, else the landing document, and hands that id to
 * `sharePlatformDestination`, which grants nothing.
 */
const fixture = vi.hoisted(() => ({
  target: vi.fn(),
  destination: vi.fn(),
}));
vi.mock("@/server/share-read", () => ({ sharedOpenTarget: fixture.target }));
vi.mock("@/server/share-platform-destination", () => ({ sharePlatformDestination: fixture.destination }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: { userId: "reader" }, personalWorkspace: { id: "personal" } }),
    unitOfWork: { run: async () => undefined },
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

beforeEach(() => {
  fixture.target.mockReset().mockResolvedValue({ kind: "FOLDER", documentId: landing });
  fixture.destination.mockReset().mockImplementation(async (_caller: unknown, documentId: string) => `/w/ws/knowledge/src/${documentId}`);
});

describe("/s/:token/open for a folder link", () => {
  it("opens the document being read when it is reachable through the link", async () => {
    fixture.target.mockResolvedValue({ kind: "FOLDER", documentId: inFolder });
    await expect(open(inFolder)).rejects.toThrow(`redirect:/w/ws/knowledge/src/${inFolder}`);
    expect(fixture.target).toHaveBeenCalledWith("tok", inFolder);
    expect(fixture.destination).toHaveBeenCalledWith({ userId: "reader" }, inFolder, "personal", {});
  });

  it("opens the landing document the one read chose when the requested one is no longer reachable", async () => {
    await expect(open(inFolder)).rejects.toThrow(`redirect:/w/ws/knowledge/src/${landing}`);
    expect(fixture.target).toHaveBeenCalledWith("tok", inFolder);
    expect(fixture.destination).toHaveBeenCalledWith({ userId: "reader" }, landing, "personal", {});
  });

  it("opens the landing document without `?d=`", async () => {
    await expect(open()).rejects.toThrow(`redirect:/w/ws/knowledge/src/${landing}`);
    expect(fixture.target).toHaveBeenCalledWith("tok", undefined);
  });

  it("lands in the reader's own home when the folder holds no document", async () => {
    fixture.target.mockResolvedValue({ kind: "FOLDER", documentId: null });
    await expect(open()).rejects.toThrow("redirect:/w/personal/home");
    expect(fixture.destination).not.toHaveBeenCalled();
  });

  it.each(["x", "", inFolder.toUpperCase(), [inFolder, inFolder]])("refuses a malformed `?d=` %j as not available, before reading anything", async (d) => {
    await expect(open(d)).rejects.toThrow("notFound");
    expect(fixture.target).not.toHaveBeenCalled();
  });

  it("is not available when the link itself does not open", async () => {
    fixture.target.mockResolvedValue(null);
    await expect(open(inFolder)).rejects.toThrow("notFound");
    expect(fixture.destination).not.toHaveBeenCalled();
  });
});

describe("/s/:token/open for a document link", () => {
  it("opens its document exactly as before when there is no `?d=`", async () => {
    fixture.target.mockResolvedValue({ kind: "DOCUMENT", documentId: "linked-doc" });
    await expect(open()).rejects.toThrow("redirect:/w/ws/knowledge/src/linked-doc");
    expect(fixture.target.mock.calls).toEqual([["tok", undefined]]);
  });

  it("refuses any `?d=`, even a well-formed one", async () => {
    fixture.target.mockResolvedValue(null);
    await expect(open(inFolder)).rejects.toThrow("notFound");
    expect(fixture.destination).not.toHaveBeenCalled();
  });
});
