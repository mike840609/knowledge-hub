// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({
  useWorkspaceAuthorization: () => ({
    confirmed: true,
    revoked: false,
    refresh: () => {},
    access: { actions: { canImport: true, canWrite: true }, workspace: { lifecycleState: "ACTIVE" } },
    navigation: {
      teamsOpen: true,
      items: [
        { id: "01a11c50-660c-76e2-8ec7-769051bd255c", type: "PERSONAL", name: "Local Knowledge User", lifecycleState: "ACTIVE" },
      ],
    },
  }),
}));

const { WorkspaceSelector } = await import("@/components/shell/workspace-selector");
const { SearchNavItem } = await import("@/components/search/search-nav-item");

function mount(html: string) {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

function buttonIn(root: Element) {
  return (root.matches("button") ? root : root.querySelector("button")) as HTMLButtonElement | null;
}

// Launcher audit (axe `label-content-name-mismatch`): both rail controls drew extra text
// beside their label — the workspace's mark letter and the ⌘K key — so what is visible did
// not match what is announced. Neither glyph is content: the shortcut is already exposed as
// `aria-keyshortcuts`, and the mark is decoration.
describe("the rail's control names", () => {
  it("announces the workspace it switches, and keeps the mark's letter out of the text", () => {
    const root = mount(renderToStaticMarkup(<WorkspaceSelector workspaceId="01a11c50-660c-76e2-8ec7-769051bd255c" />));
    const trigger = buttonIn(root)!;
    expect(trigger.getAttribute("aria-label")).toBe("Workspace: My Space");
    const mark = trigger.querySelector("[aria-hidden='true']")!;
    expect(mark.textContent).toBe("");
    expect(mark.getAttribute("data-initial")).toBe("M");
  });

  // WCAG 2.5.3 (Label in Name): the shortcut is part of what the row shows, so it is part of
  // the name. axe checks containment in the visible text *as the DOM joins it* — child text nodes
  // with no separator — so the space between the label and the badge has to be a real text node;
  // a `gap` alone fails the rule. aria-keyshortcuts still carries the key for assistive tech.
  it("announces the whole visible label, ⌘K included", () => {
    const root = mount(renderToStaticMarkup(<SearchNavItem />));
    const button = buttonIn(root)!;
    const name = button.getAttribute("aria-label")!;
    expect(name).toBe("Search ⌘K");
    // The same string a reader (and axe) sees, whitespace collapsed: the name is inside it.
    expect(button.textContent!.replace(/\s+/g, " ")).toBe(name);
    expect(button.textContent!.replace(/\s+/g, " ")).toContain(name);
  });
});
