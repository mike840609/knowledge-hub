// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { downloadMarkdown } from "@/lib/download-markdown";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("downloads markdown with a safe filename and revokes the object URL", () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => "blob:draft");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  let downloaded = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloaded = this.download;
  });

  downloadMarkdown("My/Draft", "# Body");

  expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(downloaded).toBe("My_Draft.md");
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:draft");
});

it("gives a recovered independent title a recognizable suffix within filesystem limits", () => {
  vi.useFakeTimers();
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:draft"), revokeObjectURL: vi.fn() });
  let downloaded = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloaded = this.download; });
  downloadMarkdown("長".repeat(130), "body", { recovery: true });
  expect(downloaded.endsWith(".kh-recovery.md")).toBe(true);
  expect(new TextEncoder().encode(downloaded).length).toBeLessThan(255);
});
