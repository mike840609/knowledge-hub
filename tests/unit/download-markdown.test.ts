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
