// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentHeader } from "@/components/knowledge/document-header";

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

const baseProps = {
  breadcrumb: [{ label: "Home", href: "/w/w1/knowledge" }],
  title: "First",
  status: "ACTIVE" as const,
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  revisionBanner: null,
  onShareClick: null,
  readOnly: false,
  syncHref: null,
  contentOwnsTitle: false,
};

type HeaderProps = Parameters<typeof DocumentHeader>[0];

async function renderHeader(props: Partial<HeaderProps>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<DocumentHeader {...baseProps} {...props} />);
  });
  return { host, root };
}

it("renders Details and link-summary buttons when the three props are provided", async () => {
  const { host, root } = await renderHeader({
    onDetailsClick: vi.fn(),
    linkSummary: "3 backlinks",
    onLinksClick: vi.fn(),
  });
  try {
    expect(host.querySelector('button[aria-label="Details"]')).not.toBeNull();
    expect(host.textContent).toContain("3 backlinks");
    expect(host.querySelector("h1")?.textContent).toBe("First");
  } finally {
    await act(async () => root.unmount());
  }
});

it("omits Details and link-summary buttons when the three props are absent", async () => {
  const { host, root } = await renderHeader({});
  try {
    expect(host.querySelector('button[aria-label="Details"]')).toBeNull();
    expect(host.textContent).not.toContain("backlinks");
    // Header still renders breadcrumb/title/meta.
    expect(host.querySelector("h1")?.textContent).toBe("First");
    expect(host.querySelector("nav")).not.toBeNull();
    expect(host.querySelector("time")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

// Launcher audit: the reader's title is an editable field (editable-document passes a
// textarea as `titleControl`), so a document whose markdown has no `#` line rendered with no
// heading at all — nothing for a screen reader to navigate by, and no h1 for a crawler.
it("still heads the page when the title is an editable field", async () => {
  const { host, root } = await renderHeader({
    titleControl: <textarea aria-label="Title" name="title" defaultValue="First" />,
  });
  try {
    const heading = host.querySelector("h1");
    expect(heading?.textContent).toBe("First");
    // The field is the visible title; the heading is for assistive tech only.
    expect(heading?.className).toContain("sr-only");
  } finally {
    await act(async () => root.unmount());
  }
});

// Launcher audit: "Updated 10 days ago" and "Click anywhere in the text to edit." sat in one
// row with only a flex gap between them, so the meta line read as one run-on sentence.
it("separates the edit hint from the update time", async () => {
  const { host, root } = await renderHeader({ editHint: "Click anywhere in the text to edit." });
  try {
    const meta = host.querySelector("time")!.parentElement!;
    const separator = meta.querySelector("[aria-hidden='true']");
    expect(separator?.textContent).toBe("·");
    const text = meta.textContent ?? "";
    expect(text.indexOf("·")).toBeGreaterThan(text.indexOf("Updated"));
    expect(text.indexOf("Click anywhere")).toBeGreaterThan(text.indexOf("·"));
  } finally {
    await act(async () => root.unmount());
  }
});
