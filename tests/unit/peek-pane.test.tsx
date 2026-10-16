// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PeekPane } from "@/components/knowledge/peek-pane";
import type { PeekRequest } from "@/components/knowledge/peek-request";

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
  MarkdownRenderer: ({
    markdown,
    links,
  }: {
    markdown: string;
    links?: Record<string, { status: string; basePath?: string }>;
  }) => (
    <div data-peek-markdown={markdown}>
      {Object.entries(links ?? {}).map(([key, link]) =>
        link.status === "RESOLVED" && link.basePath ? (
          <a key={key} href={link.basePath}>
            linked document
          </a>
        ) : null,
      )}
    </div>
  ),
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

const linkViewD1 = {
  documentId: "d1",
  workspaceId: "w1",
  outgoing: [
    {
      kind: "WIKI",
      target: "Second",
      fragment: null,
      display: null,
      lookupKey: "WIKI:second",
      count: 1,
      resolution: {
        status: "RESOLVED",
        documentId: "d2",
        sourceId: "s1",
        title: "Second",
        ambiguousWith: 0,
      },
    },
  ],
  unresolved: [],
  backlinks: [],
  backlinkTotal: 0,
  index: { stale: 0 },
  localGraph: null,
};

const peekD1 = {
  title: "First",
  markdown: "first body",
  ownership: "HUB_MANAGED",
  workspaceId: "w1",
  sourceId: "s1",
  documentId: "d1",
  breadcrumb: [{ label: "My Space" }, { label: "Notes" }, { label: "First" }],
  updatedAt: "2026-10-01T12:00:00.000Z",
  status: "ACTIVE",
  sourceStatus: "ACTIVE",
  readOnly: false,
  editHref: "/w/w1/knowledge/s1/d1/edit",
  syncHref: null,
  canShare: true,
  linkView: linkViewD1,
};

const peekD2 = {
  title: "Second",
  markdown: "second body",
  ownership: "HUB_MANAGED",
  workspaceId: "w1",
  sourceId: "s1",
  documentId: "d2",
  breadcrumb: [{ label: "My Space" }, { label: "Notes" }, { label: "Second" }],
  updatedAt: "2026-10-01T12:00:00.000Z",
  status: "ACTIVE",
  sourceStatus: "ACTIVE",
  readOnly: false,
  editHref: "/w/w1/knowledge/s1/d2/edit",
  syncHref: null,
  canShare: true,
  linkView: null,
};

function stubPeeks(bodies: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: unknown) => {
    const href = typeof url === "string" ? url : String(url);
    const match = href.match(/\/api\/documents\/([^/]+)\/peek/);
    const body = match ? bodies[match[1]] : undefined;
    if (body === undefined) {
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "gone" } }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

async function renderPane(request: PeekRequest = { documentId: "d1", sourceId: "s1" }) {
  const onClose = vi.fn();
  const main = document.createElement("main");
  main.textContent = "main page content";
  document.body.append(main);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<PeekPane request={request} onClose={onClose} />);
  });
  return { host, main, root, onClose };
}

it("shows the peeked document with header actions from the server fields", async () => {
  stubPeeks({ d1: peekD1 });
  const { host, root } = await renderPane();
  try {
    expect(host.querySelector("[data-peek-markdown]")?.getAttribute("data-peek-markdown")).toBe(
      "first body",
    );
    const breadcrumb = host.querySelector('nav[aria-label="Breadcrumb"]');
    expect(breadcrumb?.textContent).toContain("My Space");
    expect(breadcrumb?.textContent).toContain("First");
    expect(host.querySelector("h1")?.textContent).toBe("First");
    expect(host.querySelector('a[aria-label="Open as full page"]')?.getAttribute("href")).toBe(
      "/w/w1/knowledge/s1/d1",
    );
    expect(host.querySelector('button[aria-label="Close preview"]')).not.toBeNull();
    expect([...host.querySelectorAll("a")].some((link) => link.textContent === "Open as full page")).toBe(
      false,
    );
    expect([...host.querySelectorAll("a")].some((link) => link.textContent === "Edit")).toBe(false);
    expect(host.querySelector('a[aria-label="Edit"]')?.getAttribute("href")).toBe(
      "/w/w1/knowledge/s1/d1/edit",
    );
    expect(host.querySelector('button[aria-label="Share link…"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("asks the layout-mounted share dialog when the Share icon is pressed", async () => {
  stubPeeks({ d1: peekD1 });
  const { host, root } = await renderPane();
  try {
    const seen: string[] = [];
    const onShare = (event: Event) =>
      seen.push((event as CustomEvent<{ documentId: string }>).detail.documentId);
    window.addEventListener("kh:request-share", onShare);
    try {
      await act(async () => {
        host
          .querySelector('button[aria-label="Share link…"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
    } finally {
      window.removeEventListener("kh:request-share", onShare);
    }
    expect(seen).toEqual(["d1"]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("shows one title when the markdown opens with a heading", async () => {
  stubPeeks({ d1: { ...peekD1, markdown: "# First\n\nfirst body" } });
  const { host, root } = await renderPane();
  try {
    expect(host.querySelector("h1")).toBeNull();
    expect(host.querySelector("h2")).toBeNull();
    expect(host.querySelector('nav[aria-label="Breadcrumb"]')?.textContent).toContain("First");
  } finally {
    await act(async () => root.unmount());
  }
});

it("hides the Edit and Share entries the server did not offer and keeps the archived filter", async () => {
  window.history.replaceState(null, "", "/w/w1/knowledge/s1?includeArchived=true");
  stubPeeks({
    d2: {
      ...peekD2,
      ownership: "SOURCE_MANAGED",
      readOnly: true,
      editHref: null,
      syncHref: "/w/w1/sources/s1/update",
      canShare: false,
    },
  });
  const { host, root } = await renderPane({ documentId: "d2", sourceId: "s1" });
  try {
    expect(host.querySelector('a[aria-label="Open as full page"]')?.getAttribute("href")).toBe(
      "/w/w1/knowledge/s1/d2?includeArchived=true",
    );
    expect(host.querySelector('a[aria-label="Edit"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Share link…"]')).toBeNull();
    expect(host.textContent).toContain("Read only");
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps a same-workspace document link inside the pane and leaves the main page alone", async () => {
  stubPeeks({ d1: peekD1, d2: peekD2 });
  const { host, main, root } = await renderPane();
  try {
    const link = host.querySelector('a[href="/w/w1/knowledge/s1/d2"]');
    expect(link).not.toBeNull();
    await act(async () => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector("[data-peek-markdown]")?.getAttribute("data-peek-markdown")).toBe(
      "second body",
    );
    expect(host.querySelector("h1")?.textContent).toBe("Second");
    expect(main.textContent).toBe("main page content");
    expect(document.body.textContent).toContain("main page content");
  } finally {
    await act(async () => root.unmount());
  }
});

it("calls onClose from the Close button", async () => {
  stubPeeks({ d1: peekD1 });
  const { host, root, onClose } = await renderPane();
  try {
    const close = host.querySelector('button[aria-label="Close preview"]');
    expect(close).not.toBeNull();
    await act(async () => {
      close?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});

it("closes on Escape, unless focus is inside a dialog", async () => {
  stubPeeks({ d1: peekD1 });
  const { root, onClose } = await renderPane();
  try {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inner = document.createElement("button");
    inner.textContent = "dialog control";
    dialog.append(inner);
    document.body.append(dialog);
    await act(async () => {
      inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});

it("renders without links when linkView is null", async () => {
  stubPeeks({ d1: { ...peekD1, linkView: null } });
  const { host, root } = await renderPane();
  try {
    expect(host.querySelector("[data-peek-markdown]")?.getAttribute("data-peek-markdown")).toBe(
      "first body",
    );
    expect(host.querySelector("[data-peek-markdown] a")).toBeNull();
    expect(host.querySelector("[data-backlinks]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("reports a failed peek without page links", async () => {
  stubPeeks({});
  const { host, root } = await renderPane();
  try {
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector("a")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
