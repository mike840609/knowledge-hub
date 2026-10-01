import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Status } from "@/components/ui/status";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { syncStatusKind, syncStatusLabel } from "@/components/sources/source-list-row";

describe("Status", () => {
  it("says the state in a word as well as a glyph, and colours only the glyph", () => {
    const html = renderToStaticMarkup(<Status kind="danger">Failed</Status>);
    expect(html).toContain("Failed");
    expect(html).toContain('data-status-kind="danger"');
    // The glyph is decoration; the word is the message (WCAG 1.4.1).
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<svg[^>]*text-kh-danger/);
    expect(html).toContain("<span>Failed</span>");
  });

  it("gives each kind its own colour token, so success, failure and pending scan differently", () => {
    const colours = (["success", "danger", "pending", "archived"] as const).map((kind) => {
      const html = renderToStaticMarkup(<Status kind={kind}>x</Status>);
      return /text-kh-[a-z-]+/.exec(html.slice(html.indexOf("<svg")))?.[0];
    });
    expect(new Set(colours).size).toBe(4);
  });

  it("maps a sync run's status onto a kind, and Failed is never the success colour", () => {
    expect(syncStatusKind("APPLIED")).toBe("success");
    expect(syncStatusKind("FAILED")).toBe("danger");
    expect(syncStatusKind("PREVIEWED")).toBe("pending");
    expect(syncStatusLabel("FAILED")).toBe("Failed");
  });
});

describe("EmptyState", () => {
  it("names the state, leads with the action and teaches the shortcut", () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={FileText} title="No documents yet" description="Add a note." action={<a href="/new">New</a>} hint={<kbd>C</kbd>} />,
    );
    expect(html).toContain("<h2");
    expect(html).toContain("No documents yet");
    expect(html).toContain('href="/new"');
    expect(html).toContain("<kbd>C</kbd>");
    expect(html).toContain("text-center");
  });

  it("omits the action and hint rather than leaving empty wrappers", () => {
    const html = renderToStaticMarkup(<EmptyState icon={FileText} title="t" description="d" />);
    expect(html).not.toContain("mt-6");
    expect(html).not.toContain("mt-4 flex");
  });
});

describe("Tooltip", () => {
  it("renders only the control while closed, and leaves it its own name", () => {
    const html = renderToStaticMarkup(
      <Tooltip label="Details" shortcut="Meta+I Control+I">
        <button type="button" aria-label="Details">x</button>
      </Tooltip>,
    );
    expect(html).toContain('aria-label="Details"');
    // The native tooltip is what this replaces; neither it nor the popup is in the closed markup.
    expect(html).not.toContain("title=");
    expect(html).not.toContain("⌘I");
  });
});

describe("ConfirmDialog", () => {
  it("renders nothing while closed", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog open={false} onOpenChange={() => {}} title="Discard?" description="d" confirmLabel="Discard" onConfirm={() => {}} />,
    );
    expect(html).toBe("");
  });
});
