// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { isLinkEntry, notificationHref, notificationLabel, notificationLine, notificationTitle } from "@/components/knowledge/notification-href";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
const { InboxActivityView } = await import("@/components/knowledge/inbox-activity-view");
const { NamedShareRecipients } = await import("@/components/knowledge/named-share-recipients");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROPOSAL = "11111111-1111-4111-8111-111111111111";
const entry = (over: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id: `proposal:OWNER:${PROPOSAL}`, workspaceId: "", documentId: "", sourceId: "", documentTitle: "Quarterly plan", threadId: "", commentId: "",
  authorName: "Dana", excerpt: "", createdAt: new Date(0), readAt: null, threadStatus: "OPEN", kind: "PROPOSAL_REQUEST",
  linkAvailable: true, proposalId: PROPOSAL, proposalStatus: "PENDING", personName: "Lee", shareLinkId: "link-1", targetKind: "DOCUMENT", ...over,
});
const pending = (over: Partial<ShareCommentNotificationView> = {}) => entry({ id: `proposal:PROPOSED:${PROPOSAL}`, kind: "PROPOSAL_PENDING", personName: undefined, shareLinkId: undefined, ...over });
const decided = (status: "APPROVED" | "DECLINED", over: Partial<ShareCommentNotificationView> = {}) =>
  entry({ id: `proposal:PROPOSER:${PROPOSAL}`, kind: "PROPOSAL_DECIDED", proposalStatus: status, authorName: undefined, shareLinkId: undefined, ...over });
const dead = (over: Partial<ShareCommentNotificationView> = {}) => entry({ documentTitle: "", authorName: undefined, personName: undefined, shareLinkId: undefined, targetKind: undefined, linkAvailable: false, ...over });

describe("what a proposal entry says", () => {
  it("the owner's request names proposer, person and what the link opens", () => {
    expect(notificationLine(entry())).toBe("Dana wants to add Lee to 《Quarterly plan》");
    expect(notificationLine(entry({ targetKind: "FOLDER", documentTitle: "Plans" }))).toBe("Dana wants to add Lee to 《Plans》 folder");
  });
  it("the proposed person, while pending, learns only who and where", () => {
    expect(notificationLine(pending())).toBe("Dana mentioned you in 《Quarterly plan》 — someone proposed sharing a document with you. Waiting for the owner.");
  });
  it("the proposed person, declined, is told so without a name", () => {
    expect(notificationLine(decided("DECLINED", { personName: undefined }))).toBe("The owner declined sharing 《Quarterly plan》 with you.");
  });
  it("the proposer learns the decision about the person", () => {
    expect(notificationLine(decided("APPROVED"))).toBe("The owner added Lee to 《Quarterly plan》.");
    expect(notificationLine(decided("DECLINED"))).toBe("The owner declined adding Lee to 《Quarterly plan》.");
    expect(notificationLine(decided("DECLINED", { targetKind: "FOLDER", documentTitle: "Plans" }))).toBe("The owner declined adding Lee to 《Plans》 folder.");
  });
  it("labels each kind, and a decided request by its decision", () => {
    expect(notificationLabel(entry())).toBe("Wants to add someone");
    expect(notificationLabel(entry({ proposalStatus: "APPROVED" }))).toBe("Approved");
    expect(notificationLabel(entry({ proposalStatus: "DECLINED" }))).toBe("Declined");
    expect(notificationLabel(pending())).toBe("Waiting for owner");
    expect(notificationLabel(decided("APPROVED"))).toBe("Owner approved");
    expect(notificationLabel(decided("DECLINED"))).toBe("Owner declined");
  });
  it("opens nothing and is not a link entry", () => {
    for (const item of [entry(), pending(), decided("APPROVED"), decided("DECLINED")]) {
      expect(isLinkEntry(item.kind)).toBe(false);
      expect(notificationHref(item)).toBeNull();
    }
  });
  it("a dead one names nothing", () => {
    for (const kind of ["PROPOSAL_REQUEST", "PROPOSAL_PENDING", "PROPOSAL_DECIDED"] as const) {
      expect(notificationLine(dead({ kind }))).toBe("This link is no longer available.");
      expect(notificationTitle(dead({ kind }))).toBe("A shared document");
    }
  });
});

let host: HTMLDivElement, root: Root;
let notifications: ShareCommentNotificationView[];
let posts: string[];
let hold: Promise<void> | null;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  window.history.replaceState(null, "", "/w/me/inbox");
  posts = [];
  hold = null;
  vi.stubGlobal("ResizeObserver", class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {} disconnect() {}
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const buttons = (name: string) => [...host.querySelectorAll("button")].filter(b => b.textContent === name);

describe("the Inbox", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url.startsWith("/api/review-notifications/activity")) {
        if (init.method === "POST") { posts.push(`mark-read ${JSON.parse(String(init.body)).eventId}`); return json({ ok: true }); }
        return json({ notifications, nextCursor: null });
      }
      if (url.startsWith("/api/share-links/") && init.method === "POST") {
        posts.push(url);
        if (hold) await hold;
        notifications = notifications.map(item => ({ ...item, proposalStatus: url.endsWith("/approve") ? "APPROVED" : "DECLINED", readAt: new Date(0) }));
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${url}`);
    });
  });
  const mount = async () => { await act(async () => root.render(<InboxActivityView workspaceId="me" />)); await act(async () => {}); };

  it("the owner approves once; the buttons wait while it is sent, then the entry shows the decision", async () => {
    notifications = [entry()];
    await mount();
    expect(host.textContent).toContain("Dana wants to add Lee to 《Quarterly plan》");
    let release!: () => void;
    hold = new Promise(resolve => { release = resolve; });
    await act(async () => { buttons("Approve")[0].click(); });
    expect(buttons("Approve")[0].disabled).toBe(true);
    expect(buttons("Decline")[0].disabled).toBe(true);
    await act(async () => { buttons("Approve")[0].click(); });
    await act(async () => { release(); await hold; });
    await act(async () => {});
    expect(posts).toEqual([`/api/share-links/link-1/proposals/${PROPOSAL}/approve`]);
    // The refreshed entry is decided: its status, no buttons.
    await act(async () => { host.querySelector<HTMLElement>('[role="tab"]:nth-child(2)')!.click(); });
    expect(host.textContent).toContain("Approved");
    expect(buttons("Approve")).toHaveLength(0);
  });

  it("the owner declines through the decline route", async () => {
    notifications = [entry()];
    await mount();
    await act(async () => { buttons("Decline")[0].click(); });
    await act(async () => {});
    expect(posts).toEqual([`/api/share-links/link-1/proposals/${PROPOSAL}/decline`]);
  });

  it("a refused decision shows the server's message and keeps both buttons", async () => {
    notifications = [entry()];
    vi.stubGlobal("fetch", async (url: string) => url.startsWith("/api/share-links/")
      ? json({ error: { code: "NOT_FOUND", message: "That proposal is gone." } }, 404)
      : json({ notifications, nextCursor: null }));
    await mount();
    await act(async () => { buttons("Approve")[0].click(); });
    await act(async () => {});
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That proposal is gone.");
    expect(buttons("Approve")[0].disabled).toBe(false);
  });

  it("offers no decision on a decided or dead request, nor to anyone else", async () => {
    notifications = [entry({ id: "a", proposalStatus: "DECLINED" }), dead({ id: "b", readAt: null }), pending({ id: "c" }), decided("APPROVED", { id: "d" })];
    await mount();
    expect(buttons("Approve")).toHaveLength(0);
    expect(buttons("Decline")).toHaveLength(0);
    expect(host.textContent).toContain("Declined");
  });

  it("pending and declined rows are text only: no link, and clicking them opens no pane", async () => {
    notifications = [pending({ id: "c" }), decided("DECLINED", { id: "d", personName: undefined })];
    await mount();
    expect(host.textContent).toContain("Waiting for the owner.");
    expect(host.textContent).toContain("The owner declined sharing 《Quarterly plan》 with you.");
    expect(host.querySelector("ul a[href]")).toBeNull();
    expect(host.querySelector('[data-inbox-entry]')).toBeNull();
  });

  it("a pending request stays in the Inbox once read; a read notice leaves it", async () => {
    notifications = [entry({ id: "a", readAt: new Date(0) }), pending({ id: "c", readAt: new Date(0) })];
    await mount();
    expect(host.textContent).toContain("Dana wants to add Lee");
    expect(host.textContent).not.toContain("Waiting for the owner.");
  });
});

describe("the Manage panel", () => {
  const proposals = () => [{ id: PROPOSAL, userId: "u-lee", name: "李小龍", nameEn: "Lee", empId: "E42", orgCode: "ORG-7", proposedByName: "Dana" as string | null, createdAt: new Date(0).toISOString() }];
  let listed: ReturnType<typeof proposals>;
  beforeEach(() => {
    listed = proposals();
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url === "/api/share-links/link-1/recipients") return json({ recipients: [] });
      if (url === "/api/share-links/link-1/proposals" && (init.method ?? "GET") === "GET") return json({ proposals: listed });
      if (url.startsWith("/api/share-links/link-1/proposals/") && init.method === "POST") { posts.push(url); listed = []; return new Response(null, { status: 204 }); }
      throw new Error(`unexpected ${init.method} ${url}`);
    });
  });
  const mount = async () => { await act(async () => root.render(<NamedShareRecipients linkId="link-1" onCount={() => {}} />)); await act(async () => {}); };

  it("lists who is pending with org right-aligned, who proposed them, and both decisions", async () => {
    await mount();
    const list = host.querySelector('ul[aria-label="Pending approval"]')!;
    expect(list).not.toBeNull();
    const row = list.querySelector("li")!;
    expect(row.textContent).toContain("李小龍 · E42 · Lee");
    expect(row.textContent).toContain("proposed by Dana");
    const org = [...row.querySelectorAll("span")].find(span => span.textContent === "ORG-7")!;
    expect(org.className).toContain("shrink-0");
    expect(org.className).toContain("text-kh-text-muted");
    expect(buttons("Approve")).toHaveLength(1);
    expect(buttons("Decline")).toHaveLength(1);
    // Above the people who can open it.
    expect(host.textContent!.indexOf("Pending approval")).toBeLessThan(host.textContent!.indexOf("No one yet"));
  });

  it("approving posts once and the list is read again", async () => {
    await mount();
    await act(async () => { buttons("Approve")[0].click(); });
    await act(async () => {});
    expect(posts).toEqual([`/api/share-links/link-1/proposals/${PROPOSAL}/approve`]);
    expect(host.querySelector('ul[aria-label="Pending approval"]')).toBeNull();
  });

  it("declining posts to the decline route", async () => {
    await mount();
    await act(async () => { buttons("Decline")[0].click(); });
    await act(async () => {});
    expect(posts).toEqual([`/api/share-links/link-1/proposals/${PROPOSAL}/decline`]);
  });

  it("a proposer whose name is gone is shown as someone", async () => {
    listed = [{ ...proposals()[0], proposedByName: null }];
    await mount();
    expect(host.querySelector('ul[aria-label="Pending approval"] li')!.textContent).toContain("proposed by someone");
  });

  it("a refused decision shows the server's message and keeps the person pending", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => init.method === "POST"
      ? json({ error: { code: "SHARE_RECIPIENT_LIMIT", message: "This link already names 50 people." } }, 409)
      : original(url, init));
    await mount();
    await act(async () => { buttons("Approve")[0].click(); });
    await act(async () => {});
    expect(host.textContent).toContain("This link already names 50 people.");
    expect(host.querySelector('ul[aria-label="Pending approval"]')).not.toBeNull();
    expect(buttons("Approve")[0].disabled).toBe(false);
  });

  it("shows no pending section when nobody is proposed", async () => {
    listed = [];
    await mount();
    expect(host.textContent).not.toContain("Pending approval");
  });
});
