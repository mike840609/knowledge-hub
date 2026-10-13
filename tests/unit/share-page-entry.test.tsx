import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/server/share-read", () => ({ getSharedDocument: async () => ({ title: "Shared", markdown: "# Shared", sharedByName: "Owner", updatedAt: "2026-10-13", expiresAt: "2026-10-20", revisionId: "revision" }) }));
vi.mock("@/components/knowledge/save-share-button", () => ({ SaveShareButton: () => null }));
vi.mock("@/components/knowledge/shared-review-panel", () => ({ SharedReviewPanel: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/knowledge/markdown-renderer", () => ({ MarkdownRenderer: () => null }));
vi.mock("@/components/ui/timestamp", () => ({ Timestamp: () => null }));
import SharedDocumentPage from "@/app/s/[token]/page";

afterEach(() => vi.unstubAllEnvs());

it("navigates both entry buttons to the company gateway with native links", async () => {
  vi.stubEnv("KM_PUBLIC_ORIGIN", "https://hub.example.com/");
  const html = renderToStaticMarkup(await SharedDocumentPage({ params: Promise.resolve({ token: "share-token" }) }));
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>(Open in Knowledge Hub|Get started)<\/a>/g)];
  expect(links).toHaveLength(2);
  expect(links.map(link => link[1])).toEqual(["https://hub.example.com/?returnTo=%2Fs%2Fshare-token%2Fopen", "https://hub.example.com/?returnTo=%2Fs%2Fshare-token%2Fopen"]);
  expect(links.every(link => !link[0].includes("data-next"))).toBe(true);
});

it("keeps the document-opening flow when no company gateway is configured", async () => {
  vi.stubEnv("KM_PUBLIC_ORIGIN", "");
  const html = renderToStaticMarkup(await SharedDocumentPage({ params: Promise.resolve({ token: "share-token" }) }));
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>(Open in Knowledge Hub|Get started)<\/a>/g)];
  expect(links.map(link => link[1])).toEqual(["/s/share-token/open", "/s/share-token/open"]);
});
