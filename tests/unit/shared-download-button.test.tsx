// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedDownloadButton } from "@/components/knowledge/shared-download-button";
import { downloadMarkdown } from "@/lib/download-markdown";
import { exportMarkdown } from "@/lib/markdown-export";
vi.mock("@/lib/download-markdown", () => ({ downloadMarkdown: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); vi.mocked(downloadMarkdown).mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("downloads the exported Markdown once on click", async () => {
  const metadata = { tags: ["ops"] };
  await act(async () => root.render(<SharedDownloadButton title="Runbook" markdown="body" metadata={metadata} />));
  const button = host.querySelector("button")!;
  expect(button.textContent).toBe("Download Markdown");
  await act(async () => button.click());
  expect(downloadMarkdown).toHaveBeenCalledTimes(1);
  expect(downloadMarkdown).toHaveBeenCalledWith("Runbook", exportMarkdown({ title: "Runbook", markdown: "body", metadata }));
});
