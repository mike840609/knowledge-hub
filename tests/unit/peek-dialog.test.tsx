// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PeekRequest } from "@/components/knowledge/peek-request";
import { PeekDialog } from "@/components/knowledge/peek-dialog";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/knowledge/markdown-renderer", () => ({
  MarkdownRenderer: ({ markdown }: { markdown: string }) => <div data-peek-markdown={markdown} />,
}));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  requestWorkspaceAccessCheck: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

function stubPeek(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

async function openPeek(documentId = "d1", sourceId = "s1", onOpenChange: (open: boolean) => void = () => {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const request: PeekRequest = { documentId, sourceId };
  await act(async () => {
    root.render(<PeekDialog request={request} onOpenChange={onOpenChange} />);
  });
  return { host, root };
}

const hubPeek = {
  title: "Guide",
  markdown: "# Guide",
  ownership: "HUB_MANAGED",
  workspaceId: "w1",
  sourceId: "s1",
  documentId: "d1",
};

it("shows the peeked document with an Edit entry for HUB_MANAGED content", async () => {
  stubPeek(hubPeek);
  const { root } = await openPeek();
  try {
    expect(document.body.textContent).toContain("Guide");
    expect(document.body.querySelector("[data-peek-markdown]")?.getAttribute("data-peek-markdown")).toBe(
      "# Guide",
    );
    const links = [...document.body.querySelectorAll("a")];
    const open = links.find((link) => link.textContent === "Open as full page");
    expect(open?.getAttribute("href")).toBe("/w/w1/knowledge/s1/d1");
    const edit = links.find((link) => link.textContent === "Edit");
    expect(edit?.getAttribute("href")).toBe("/w/w1/knowledge/s1/d1/edit");
  } finally {
    await act(async () => root.unmount());
  }
});

it("hides the Edit entry for SOURCE_MANAGED content and keeps the archived filter", async () => {
  window.history.replaceState(null, "", "/w/w1/knowledge/s1?includeArchived=true");
  stubPeek({ ...hubPeek, ownership: "SOURCE_MANAGED", documentId: "d2" });
  const { root } = await openPeek("d2");
  try {
    const links = [...document.body.querySelectorAll("a")];
    expect(links.find((link) => link.textContent === "Open as full page")?.getAttribute("href")).toBe(
      "/w/w1/knowledge/s1/d2?includeArchived=true",
    );
    expect(links.some((link) => link.textContent === "Edit")).toBe(false);
    expect(document.body.textContent).toContain("Synced from a folder");
  } finally {
    await act(async () => root.unmount());
  }
});

it("reports a failed peek without opening the full page", async () => {
  stubPeek({ error: { code: "NOT_FOUND", message: "gone" } }, 404);
  const { root } = await openPeek();
  try {
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.querySelector("a")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
