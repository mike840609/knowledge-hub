import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedFolderView, SharedView } from "@/modules/knowledge/application/document-share-service";
import { linkLookupKey } from "@/modules/knowledge/domain/link-graph";

/** The page a folder link opens (folder share spec §4, §5). */
const fixture = vi.hoisted(() => ({ getShared: vi.fn() }));
vi.mock("@/server/share-read", () => ({ getShared: fixture.getShared }));
vi.mock("@/components/knowledge/save-share-button", () => ({ SaveShareButton: ({ token }: { token: string }) => <button data-save={token}>Save</button> }));
type PanelProps = { token: string; documentId?: string; revisionId: string; signInHref: string; wide?: boolean; brand?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode };
vi.mock("@/components/knowledge/shared-review-panel", () => ({
  SharedReviewPanel: ({ token, documentId, revisionId, signInHref, wide, brand, actions, children }: PanelProps) => (
    <div data-review-panel="" data-token={token} data-document={documentId} data-revision={revisionId} data-sign-in={signInHref} data-wide={wide ? "" : undefined}>
      <header data-bar="">{brand}{actions}</header>
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/timestamp", () => ({ Timestamp: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));
import SharedPage, { generateMetadata } from "@/app/s/[token]/page";

const ids = {
  welcome: "0192f3a4-0000-7000-8000-000000000001",
  setup: "0192f3a4-0000-7000-8000-000000000002",
  review: "0192f3a4-0000-7000-8000-000000000003",
  faq: "0192f3a4-0000-7000-8000-000000000004",
};
const folderView = (document: SharedFolderView["document"]): SharedFolderView => ({
  kind: "FOLDER",
  folderName: "Onboarding",
  sharedByName: "Mike",
  expiresAt: new Date("2026-11-27T00:00:00Z"),
  tree: [
    { id: "n-welcome", parentId: null, kind: "DOCUMENT", name: "Welcome", documentId: ids.welcome, pageIcon: null },
    { id: "n-eng", parentId: null, kind: "FOLDER", name: "Engineering", documentId: null, pageIcon: null },
    { id: "n-setup", parentId: "n-eng", kind: "DOCUMENT", name: "Dev setup", documentId: ids.setup, pageIcon: "🛠" },
    { id: "n-review", parentId: "n-eng", kind: "DOCUMENT", name: "Code review", documentId: ids.review, pageIcon: null },
    { id: "n-hr", parentId: null, kind: "FOLDER", name: "HR", documentId: null, pageIcon: null },
    { id: "n-faq", parentId: null, kind: "DOCUMENT", name: "FAQ", documentId: ids.faq, pageIcon: null },
  ],
  document,
});
const setup = {
  documentId: ids.setup,
  revisionId: "rev",
  title: "Dev setup",
  markdown: "Install Node. See [[Code review]] and [[Secret plan]] and [the wiki](../elsewhere.md).",
  pageIcon: "🛠",
  sharedByName: "Mike",
  updatedAt: new Date("2026-10-28T00:00:00Z"),
  expiresAt: new Date("2026-11-27T00:00:00Z"),
  path: [{ id: "n-eng", name: "Engineering" }],
  links: [{ lookupKey: linkLookupKey("WIKI", "Code review"), documentId: ids.review, title: "Code review" }],
};

const render = async (d?: string | string[], token = "tok") => renderToStaticMarkup(await SharedPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve(d === undefined ? {} : { d }) }));
const shared = (view: SharedView | null) => fixture.getShared.mockResolvedValue(view);

beforeEach(() => { fixture.getShared.mockReset(); vi.stubEnv("KM_PUBLIC_ORIGIN", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("a folder link's page", () => {
  it("reads the document named by `?d=`, as navigation the service judges", async () => {
    shared(folderView(setup));
    await render(ids.setup);
    expect(fixture.getShared).toHaveBeenCalledWith("tok", ids.setup);
  });

  it("names where the document sits, from the shared folder down, in the pinned bar", async () => {
    shared(folderView(setup));
    const html = await render(ids.setup);
    const crumbs = html.match(/<nav aria-label="Breadcrumb"[^>]*>(.*?)<\/nav>/)![1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(crumbs).toBe("Onboarding / Engineering / Dev setup");
    expect(html).toMatch(/<li[^>]*aria-current="location"[^>]*>Dev setup<\/li>/);
  });

  it("lists the folder in a tree: the document read is current, the folders on its path open, the rest closed", async () => {
    shared(folderView(setup));
    const html = await render(ids.setup);
    const current = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag).filter(tag => tag.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="/s/tok?d=${ids.setup}"`);
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*>.*?Engineering/);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*?HR/);
    expect(html).toContain(`href="/s/tok?d=${ids.faq}"`);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("links an in-folder wikilink within the link, and reads every other link as its text", async () => {
    shared(folderView(setup));
    const article = (await render(ids.setup)).match(/<article[^>]*>(.*)<\/article>/)![1];
    expect(article).toMatch(new RegExp(`<a[^>]*href="/s/tok\\?d=${ids.review}"[^>]*>Code review</a>`));
    expect(article).toContain("<span>Secret plan</span>");
    expect(article).toContain("<span>the wiki</span>");
    expect(article).not.toContain("data-unresolved-link");
  });

  it("shows the title, then who shared it, then the article", async () => {
    shared(folderView(setup));
    const html = await render(ids.setup);
    const [title, byline, body] = ["Dev setup</h1>", "Shared by Mike", "Install Node."].map(text => html.indexOf(text));
    expect(title).toBeGreaterThan(-1);
    expect(byline).toBeGreaterThan(title);
    expect(body).toBeGreaterThan(byline);
  });

  it("saves the folder link, and opens the document being read in the Hub", async () => {
    shared(folderView(setup));
    const html = await render(ids.setup);
    expect(html).toContain('data-save="tok"');
    expect(html).toContain(`href="/s/tok/open?d=${ids.setup}"`);
    vi.stubEnv("KM_PUBLIC_ORIGIN", "https://hub.example.com/");
    expect(await render(ids.setup)).toContain(`href="https://hub.example.com/?${new URLSearchParams({ returnTo: `/s/tok/open?d=${ids.setup}` }).toString().replace(/&/g, "&amp;")}"`);
  });

  it("offers the discussions of the document read, naming it, in the folder page's own wide bar (spec §6)", async () => {
    shared(folderView(setup));
    const html = await render(ids.setup);
    const panel = html.match(/<div data-review-panel=""[^>]*>/)![0];
    expect(panel).toContain('data-token="tok"');
    expect(panel).toContain(`data-document="${ids.setup}"`);
    expect(panel).toContain('data-revision="rev"');
    expect(panel).toContain("data-wide");
    // The bar keeps the tree, brand, breadcrumb, Save and Open, now beside Comments.
    const bar = html.match(/<header data-bar="">(.*?)<\/header>/s)![1];
    for (const part of ['aria-label="Breadcrumb"', "Knowledge Hub", 'data-save="tok"', `/s/tok/open?d=${ids.setup}`, "Folder contents"]) expect(bar).toContain(part);
  });

  it("signs a reader in to comment and brings them back to the document they were reading", async () => {
    shared(folderView(setup));
    const signIn = (await render(ids.setup)).match(/data-sign-in="([^"]*)"/)![1].replace(/&amp;/g, "&");
    expect(new URLSearchParams(signIn.split("?")[1]).get("returnTo")).toBe(`/s/tok?d=${ids.setup}`);
  });

  it("says an empty folder has no documents yet, and draws no article", async () => {
    shared({ ...folderView(null), tree: [] });
    const html = await render();
    expect(html).toContain("This folder has no documents yet.");
    expect(html).not.toContain("<article");
    expect(html).not.toContain("data-review-panel");
    expect(html).toContain("Onboarding");
  });

  it.each(["x", "", ids.setup.toUpperCase(), [ids.setup, ids.faq]])("is not available for a malformed `?d=` %j, and reads nothing", async (d) => {
    await expect(render(d)).rejects.toThrow("notFound");
    expect(fixture.getShared).not.toHaveBeenCalled();
  });

  it("is not available when the service refuses the document", async () => {
    shared(null);
    await expect(render(ids.setup)).rejects.toThrow("notFound");
  });
});

describe("a document link's page", () => {
  it("still resolves no links: a [[wikilink]] is its text", async () => {
    shared({ kind: "DOCUMENT", revisionId: "rev", title: "Doc", markdown: "See [[Code review]].", pageIcon: null, sharedByName: "Mike", updatedAt: new Date(), expiresAt: new Date() });
    const html = await render();
    expect(fixture.getShared).toHaveBeenCalledWith("tok", undefined);
    expect(html).toContain("<span>Code review</span>");
    expect(html).toContain("data-review-panel");
    // A document link's page names no document to the review API, and keeps the reading column's bar.
    expect(html).not.toContain("data-document=");
    expect(html).not.toContain("data-wide");
    expect(new URLSearchParams(html.match(/data-sign-in="([^"]*)"/)![1].replace(/&amp;/g, "&").split("?")[1]).get("returnTo")).toBe("/s/tok");
  });
});

describe("metadata", () => {
  it("titles a folder page by the document read, else the folder; never indexed, no Open Graph", async () => {
    shared(folderView(setup));
    const withDocument = await generateMetadata({ params: Promise.resolve({ token: "tok" }), searchParams: Promise.resolve({ d: ids.setup }) });
    expect(withDocument).toEqual({ title: "Dev setup", description: null, robots: { index: false, follow: false } });
    expect(fixture.getShared).toHaveBeenCalledWith("tok", ids.setup);
    shared(folderView(null));
    expect((await generateMetadata({ params: Promise.resolve({ token: "tok" }), searchParams: Promise.resolve({}) })).title).toBe("Onboarding");
  });

  it("titles a malformed `?d=` as not available, without reading", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ token: "tok" }), searchParams: Promise.resolve({ d: "x" }) });
    expect(metadata.title).toBe("Link not available");
    expect(fixture.getShared).not.toHaveBeenCalled();
  });
});
