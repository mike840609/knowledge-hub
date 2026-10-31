// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishDialog, type PublishOriginOption, type PublishTeamOption } from "@/components/publications/publish-dialog";
import { PublicationMenu } from "@/components/publications/publication-menu";
import { formatShortTimeZhTw } from "@/lib/format-date";
import { JoinDialog } from "@/components/publications/join-dialog";
import {
  PUBLICATION_COPY,
  PublicationDocumentMetaLine,
  PublicationEntryMeta,
  publicationTreeMeta,
  type PublicationTreeMeta,
} from "@/components/publications/publication-entry-meta";
import { PublicationSyncNotices, refreshPublicationStatuses } from "@/components/publications/maintained-by-notice";
import { assignableTeamRoles, teamRoleLabel, teamRoleOptions } from "@/components/workspaces/team-role";
import { actionsFor, availableActions, type ActionContext } from "@/components/actions/action-registry";
import { startActions } from "@/components/knowledge/sidebar-get-started";
import type { PublicationListItem } from "@/modules/sources/application/publication-service";
import type { PublicationDocumentView, PublicationNotice } from "@/modules/sources/domain/publication";
import { OwnerReviewPanel } from "@/components/knowledge/owner-review-panel";
import type { ReviewThreadView } from "@/modules/knowledge/domain/document-review";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => mocks.toast }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.push.mockReset();
  mocks.toast.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchRoutes(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const route = Object.keys(routes).find((key) => url.includes(key));
    if (!route) throw new Error(`Unexpected fetch ${url}`);
    void init;
    return routes[route]();
  });
}

const origin: PublishOriginOption = { kind: "DOCUMENT", documentId: "d1", label: "HCM KM 設計" };
const team: PublishTeamOption = { id: "team-1", name: "HCM Team" };

function nameInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
}
function submitButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`No button ${label}`);
  return button;
}

describe("publish dialog", () => {
  it("prefills the origin name and previews only the teams it was given", async () => {
    const fetch = fetchRoutes({
      "/api/publications/preview": () => jsonResponse({ nameTaken: false, refusedOriginals: [], joinSuggestion: null, lowOverlapWarning: false }),
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PublishDialog open onOpenChange={() => {}} origin={origin} teams={[team]} />));
    await settle();
    expect(nameInput().value).toBe("HCM KM 設計");
    expect(fetch).toHaveBeenCalledWith("/api/publications/preview", expect.objectContaining({ method: "POST" }));
    expect(document.body.textContent).toContain("HCM Team");
  });

  it("says there is no publishable team when the server returned none", async () => {
    vi.stubGlobal("fetch", fetchRoutes({}));
    await act(async () => root.render(<PublishDialog open onOpenChange={() => {}} origin={origin} teams={[]} />));
    await settle();
    expect(document.body.textContent).toContain("沒有可發佈的團隊");
    expect(submitButton(PUBLICATION_COPY.publish).disabled).toBe(true);
  });

  it("offers joining a strongly overlapping publication instead", async () => {
    const onOfferJoin = vi.fn();
    vi.stubGlobal("fetch", fetchRoutes({
      "/api/publications/preview": () => jsonResponse({
        nameTaken: false,
        refusedOriginals: [],
        joinSuggestion: { publicationId: "pub-1", name: "HCM KM", overlap: 0.8 },
        lowOverlapWarning: false,
      }),
    }));
    await act(async () => root.render(<PublishDialog open onOpenChange={() => {}} origin={origin} teams={[team]} onOfferJoin={onOfferJoin} />));
    await settle();
    const suggestion = submitButton("改為加入「HCM KM」");
    await act(async () => suggestion.click());
    expect(onOfferJoin).toHaveBeenCalledWith({ publicationId: "pub-1", name: "HCM KM" });
  });

  it("shows a name error inline and stays open", async () => {
    const onOpenChange = vi.fn();
    vi.stubGlobal("fetch", fetchRoutes({
      "/api/publications/preview": () => jsonResponse({ nameTaken: false, refusedOriginals: [], joinSuggestion: null, lowOverlapWarning: false }),
      "/api/publications": () => jsonResponse({ error: { code: "PUBLICATION_NAME_TAKEN", message: "已有同名發佈，請取一個能說明內容的名字" } }, 400),
    }));
    await act(async () => root.render(<PublishDialog open onOpenChange={onOpenChange} origin={origin} teams={[team]} />));
    await settle();
    await act(async () => submitButton(PUBLICATION_COPY.publish).click());
    await settle();
    expect(document.body.textContent).toContain("已有同名發佈");
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("keeps a claim error visible and does not submit twice", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/preview")) {
        return jsonResponse({ nameTaken: false, refusedOriginals: [], joinSuggestion: null, lowOverlapWarning: false });
      }
      return pending;
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PublishDialog open onOpenChange={() => {}} origin={origin} teams={[team]} />));
    await settle();
    const button = submitButton(PUBLICATION_COPY.publish);
    await act(async () => { button.click(); button.click(); });
    expect(fetch.mock.calls.filter(([url]) => String(url) === "/api/publications")).toHaveLength(1);
    await act(async () => release(jsonResponse({ error: { code: "PUBLICATION_ORIGINAL_TAKEN", message: "taken", details: { publicationName: "HCM KM" } } }, 409)));
    await settle();
    expect(document.body.textContent).toContain("已在「HCM KM」發佈");
  });
});

describe("join dialog", () => {
  const folders = [{ folderNodeId: "f1", label: "Mike Repo / docs" }, { folderNodeId: "f2", label: "Mike Repo / docs-v2" }];

  it("requires an acknowledgement after a low-overlap refusal", async () => {
    const fetch = fetchRoutes({
      "/join": () => jsonResponse({ error: { code: "PUBLICATION_JOIN_LOW_OVERLAP", message: "low" } }, 409),
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<JoinDialog open onOpenChange={() => {}} publication={{ publicationId: "p1", name: "HCM KM" }} folders={[folders[0]]} />));
    await settle();
    await act(async () => submitButton(PUBLICATION_COPY.join).click());
    await settle();
    expect(document.body.textContent).toContain(PUBLICATION_COPY.lowOverlapAcknowledge);
    expect(submitButton("仍要加入").disabled).toBe(true);
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.click());
    expect(submitButton("仍要加入").disabled).toBe(false);
    await act(async () => submitButton("仍要加入").click());
    await settle();
    const last = fetch.mock.calls.at(-1)!;
    expect(JSON.parse(String(last[1]?.body))).toMatchObject({ acknowledgeLowOverlap: true, folderNodeId: "f1" });
  });

  it("drops a warning and its acknowledgement when another folder is chosen", async () => {
    const fetch = fetchRoutes({
      "/join": () => jsonResponse({ error: { code: "PUBLICATION_JOIN_LOW_OVERLAP", message: "low" } }, 409),
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<JoinDialog open onOpenChange={() => {}} publication={{ publicationId: "p1", name: "HCM KM" }} folders={folders} />));
    await settle();
    async function choose(label: string) {
      await act(async () => document.querySelector<HTMLElement>('[aria-label="你的資料夾"]')!.click());
      await settle();
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) => candidate.textContent?.includes(label));
      if (!option) throw new Error(`No folder option ${label}`);
      // The item commits on click only when it is highlighted, as a pointer does.
      await act(async () => option.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
      await settle();
      await act(async () => option.click());
      await settle();
    }
    await choose("Mike Repo / docs");
    await act(async () => submitButton(PUBLICATION_COPY.join).click());
    await settle();
    expect(document.body.textContent).toContain(PUBLICATION_COPY.lowOverlapAcknowledge);

    // Choosing another folder starts over: no warning, no carried acknowledgement.
    await choose("docs-v2");
    expect(document.body.textContent).not.toContain(PUBLICATION_COPY.lowOverlapAcknowledge);
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')).toBeNull();
    const submit = submitButton(PUBLICATION_COPY.join);
    expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    await settle();
    const last = fetch.mock.calls.at(-1)!;
    expect(JSON.parse(String(last[1]?.body))).toEqual({ folderNodeId: "f2" });
  });

  it("loads the caller's folders from options when the menu did not pass them", async () => {
    const fetch = fetchRoutes({
      "/api/publications/options": () => jsonResponse({
        teams: [],
        folders: [{ folderNodeId: "loaded-1", label: "Loaded Repo / docs" }],
      }),
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<JoinDialog open onOpenChange={() => {}} publication={{ publicationId: "p1", name: "HCM KM" }} />));
    await settle();
    expect(document.body.textContent).toContain("Loaded Repo / docs");
    expect(submitButton(PUBLICATION_COPY.join).disabled).toBe(false);
  });
});

describe("team tree metadata", () => {
  const document: PublicationDocumentView = {
    teamDocumentId: "td1", sourcePath: "docs/a.md", status: "ACTIVE",
    creatorUserId: "u2", creatorName: "Mike", updatedAt: new Date("2026-10-28T00:00:00Z"),
    leftAt: null, rightsFrozenAt: null, pendingCatchUp: false,
  };
  const item: PublicationListItem = {
    publication: { id: "p1", sourceId: "s1", teamWorkspaceId: "t1", name: "HCM KM", kind: "FOLDER", creatorUserId: "u2", status: "ACTIVE" },
    creatorName: "Mike",
    updatedAt: new Date("2026-10-28T00:00:00Z"),
    canJoin: true,
    canManage: false,
    documents: [document],
    ownContribution: { id: "c1", userId: "u2", leftAt: null, rightsFrozenAt: null, pendingCatchUp: false },
  };

  it("names the creator, the relative time and the maintainer", async () => {
    const meta = publicationTreeMeta(item);
    await act(async () => root.render(<PublicationEntryMeta meta={meta} />));
    expect(container.textContent).toContain("Mike");
    expect(container.textContent).toContain("更新");
    await act(async () => root.render(<PublicationDocumentMetaLine meta={meta.documents.td1} />));
    expect(container.textContent).toContain("由 Mike 維護");
    expect(container.textContent).toContain("更新者");
    expect(container.textContent).not.toContain("作者");
  });

  it("distinguishes left, frozen and pending", () => {
    expect(publicationTreeMeta({ ...item, ownContribution: { ...item.ownContribution!, leftAt: new Date() } }).state).toBe("LEFT");
    expect(publicationTreeMeta({ ...item, ownContribution: { ...item.ownContribution!, rightsFrozenAt: new Date() } }).state).toBe("FROZEN");
    expect(publicationTreeMeta({ ...item, ownContribution: { ...item.ownContribution!, pendingCatchUp: true } }).state).toBe("PENDING");
  });

  it("shows another maintainer's left, frozen and pending state to a viewer who does not own it", () => {
    // Ann reads Mike's documents: her own contribution (or none) says nothing
    // about whether Mike's copy is still updated.
    const viewer: PublicationListItem = {
      ...item,
      canJoin: false,
      ownContribution: { id: "c3", userId: "u3", leftAt: null, rightsFrozenAt: null, pendingCatchUp: false },
    };
    const leftState = publicationTreeMeta({
      ...viewer,
      documents: [{ ...document, leftAt: new Date("2026-10-20T00:00:00Z") }],
    });
    expect(leftState.documents.td1.state).toBe("LEFT");
    expect(leftState.documents.td1.maintainerName).toBe("Mike");

    const frozenState = publicationTreeMeta({
      ...viewer,
      ownContribution: null,
      documents: [{ ...document, rightsFrozenAt: new Date("2026-10-20T00:00:00Z") }],
    });
    expect(frozenState.documents.td1.state).toBe("FROZEN");

    const pendingState = publicationTreeMeta({
      ...viewer,
      ownContribution: null,
      documents: [{ ...document, pendingCatchUp: true }],
    });
    expect(pendingState.documents.td1.state).toBe("PENDING");

    // The viewer's own pending contribution never labels Mike's copy.
    const ownPending = publicationTreeMeta({
      ...viewer,
      ownContribution: { id: "c3", userId: "u3", leftAt: null, rightsFrozenAt: null, pendingCatchUp: true },
      documents: [document],
    });
    expect(ownPending.state).toBe("PENDING");
    expect(ownPending.documents.td1.state).toBe("ACTIVE");
  });

  it("labels a left contribution as no longer updated and a pending one as waiting", async () => {
    const left: PublicationTreeMeta = publicationTreeMeta({ ...item, ownContribution: { ...item.ownContribution!, leftAt: new Date() } });
    await act(async () => root.render(<PublicationEntryMeta meta={left} />));
    expect(container.textContent).toContain("不再更新");
    const pending = publicationTreeMeta({ ...item, ownContribution: { ...item.ownContribution!, pendingCatchUp: true } });
    await act(async () => root.render(<PublicationEntryMeta meta={pending} />));
    expect(container.textContent).toContain("等待同步");
    expect(container.textContent).not.toContain("不再更新");
  });
});

describe("sync publication notices", () => {
  const notices: PublicationNotice[] = [
    { publicationId: "p1", code: "MAINTAINED_BY_OTHER", maintainerUserId: "u2", maintainerName: "Mike", sourcePath: "docs/a.md" },
    { publicationId: "p1", code: "PATH_RESERVED", sourcePath: "docs/b.md" },
  ];

  it("says who maintains the copy and why a path stayed blocked", async () => {
    await act(async () => root.render(<PublicationSyncNotices notices={notices} names={{}} />));
    expect(container.textContent).toContain("由 Mike 維護，你的版本不會更新團隊");
    expect(container.textContent).toContain("docs/b.md");
    expect(container.textContent).toContain("保留給其他文件");
  });

  it("refreshes the caller's own status after a sync completes", async () => {
    const fetch = fetchRoutes({
      "/api/publications/p1/status": () => jsonResponse({ pending: true, report: null }),
    });
    vi.stubGlobal("fetch", fetch);
    const result = await refreshPublicationStatuses(["p1", "p1"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ publicationId: "p1", pending: true }]);
  });
});

describe("Traditional Chinese relative time", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  it("says 剛剛, days, then the month and day", () => {
    expect(formatShortTimeZhTw(new Date(now - 20_000), now, "UTC")).toBe("剛剛");
    expect(formatShortTimeZhTw(new Date(now - 6 * 86_400_000), now, "UTC")).toBe("6 天前");
    expect(formatShortTimeZhTw(new Date("2026-10-12T08:00:00Z"), now, "UTC")).toBe("10/12");
    expect(formatShortTimeZhTw(new Date("2025-10-12T08:00:00Z"), now, "UTC")).toBe("2025/10/12");
  });
});

describe("publication menu", () => {
  const managed: PublicationListItem = {
    publication: { id: "p1", sourceId: "s1", teamWorkspaceId: "t1", name: "HCM KM", kind: "FOLDER", creatorUserId: "u2", status: "ACTIVE" },
    creatorName: "Mike",
    updatedAt: new Date("2026-10-28T00:00:00Z"),
    canJoin: false,
    canManage: true,
    documents: [],
    ownContribution: { id: "c1", userId: "u2", leftAt: null, rightsFrozenAt: null, pendingCatchUp: false },
  };

  async function openMenu(item: PublicationListItem) {
    await act(async () => root.render(<PublicationMenu item={item} />));
    await settle();
    await act(async () => document.querySelector<HTMLElement>('[aria-label="HCM KM 的發佈操作"]')!.click());
    await settle();
  }

  it("asks before unpublishing, because the UI offers no undo", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", requestFetch);
    await openMenu(managed);
    await act(async () => document.querySelector<HTMLElement>('[data-publication-action="unpublish"]')!.click());
    await settle();
    expect(document.body.textContent).toContain("這會把整個發佈");
    expect(requestFetch).not.toHaveBeenCalled();
    await act(async () => submitButton("取消發佈").click());
    await settle();
    expect(requestFetch).toHaveBeenCalledWith("/api/publications/p1/unpublish", expect.objectContaining({ method: "POST" }));
  });

  it("reports a refused command through the toast region that outlives the menu", async () => {
    vi.stubGlobal("fetch", fetchRoutes({
      "/leave": () => jsonResponse({ error: { code: "WORKSPACE_ACCESS_DENIED", message: "沒有權限離開這個發佈。" } }, 403),
    }));
    await openMenu(managed);
    await act(async () => document.querySelector<HTMLElement>('[data-publication-action="leave"]')!.click());
    await settle();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ message: "沒有權限離開這個發佈。", tone: "danger" }));
    expect(document.querySelector('[role="menu"] [role="alert"]')).toBeNull();
  });
});

describe("team authoring entry points", () => {
  const context = (workspaceType: "PERSONAL" | "TEAM"): ActionContext => ({
    workspaceId: "w1",
    workspaceType,
    isPersonalOwner: workspaceType === "PERSONAL",
    can: { canWrite: true, canImport: true, canSearch: true, canInspectSources: true, canOpenSettings: true },
    confirmed: true,
  });

  it("offers no create, folder, import or duplicate action in a team", () => {
    const hubTarget = {
      documentId: "d1", sourceId: "s1", label: "Doc", ownership: "HUB_MANAGED" as const,
      status: "ACTIVE" as const, sourceStatus: "ACTIVE" as const,
      revision: "CURRENT" as const, favorite: false,
    };
    const ids = [
      ...actionsFor("palette", context("TEAM")),
      ...actionsFor("create", context("TEAM")),
      ...actionsFor("empty", context("TEAM")),
      ...actionsFor("row", { ...context("TEAM"), target: hubTarget }),
      ...actionsFor("row", { ...context("TEAM"), folder: { nodeId: "n1", sourceId: "s1", label: "Folder", ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE" } }),
    ].map((action) => action.id);
    expect(ids).not.toContain("create.document");
    expect(ids).not.toContain("create.folder");
    expect(ids).not.toContain("create.import");
    expect(ids).not.toContain("folder.new-document");
    expect(ids).not.toContain("folder.new-folder");
    expect(ids).not.toContain("document.duplicate");
    // Sources itself stays reachable: only the authoring entries inside it are hidden.
    expect(ids).toContain("navigate.sources");
    expect(actionsFor("empty", context("TEAM"))).toEqual([]);
    expect(startActions(context("TEAM"))).toEqual([]);
  });

  it("keeps the same entry points in My Space", () => {
    const ids = availableActions(context("PERSONAL")).map((action) => action.id);
    expect(ids).toContain("create.document");
    expect(ids).toContain("create.folder");
    expect(ids).toContain("create.import");
    expect(ids).toContain("navigate.sources");
    expect(startActions(context("PERSONAL")).length).toBeGreaterThan(0);
  });

  it("offers publish from My Space for a document and a folder", () => {
    const base = context("PERSONAL");
    const documentActions = availableActions({
      ...base,
      target: { documentId: "d1", sourceId: "s1", label: "Doc", ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE", revision: "CURRENT", favorite: false },
    });
    expect(documentActions.find((action) => action.id === "document.publish")?.effect)
      .toEqual({ kind: "publish", origin: { kind: "DOCUMENT", documentId: "d1", label: "Doc" } });
    const folderActions = availableActions({
      ...base,
      folder: { nodeId: "n1", sourceId: "s1", label: "Folder", ownership: "HUB_MANAGED", status: "ACTIVE", sourceStatus: "ACTIVE" },
    });
    expect(folderActions.find((action) => action.id === "folder.publish")?.effect)
      .toEqual({ kind: "publish", origin: { kind: "FOLDER", folderNodeId: "n1", label: "Folder" } });
    expect(availableActions(context("TEAM")).some((action) => action.effect.kind === "publish")).toBe(false);
  });
});

describe("team roles", () => {
  it("offers exactly 管理員 and 成員, and never rewrites OWNER or VIEWER", () => {
    expect(assignableTeamRoles(["OWNER", "ADMIN", "EDITOR", "VIEWER"])).toEqual(["ADMIN", "EDITOR"]);
    expect(teamRoleLabel("ADMIN")).toBe("管理員（ADMIN）");
    expect(teamRoleLabel("EDITOR")).toBe("成員（EDITOR）");
    expect(teamRoleOptions(["ADMIN", "EDITOR", "VIEWER"], "VIEWER")).toEqual([
      { value: "VIEWER", label: "檢視者（VIEWER）", disabled: true },
      { value: "ADMIN", label: "管理員（ADMIN）" },
      { value: "EDITOR", label: "成員（EDITOR）" },
    ]);
    expect(teamRoleOptions(["ADMIN", "EDITOR"], "OWNER")[0]).toMatchObject({ value: "OWNER", disabled: true });
  });
});

describe("team document discussion", () => {
  const thread: ReviewThreadView = {
    id: "t1",
    status: "OPEN",
    createdAt: new Date("2026-10-28T00:00:00Z"),
    updatedAt: new Date("2026-10-28T00:00:00Z"),
    currentAnchor: { match: "OUTDATED" },
    comments: [{
      id: "c1", threadId: "t1", authorName: "Ann", body: "hello", createdAt: new Date("2026-10-28T00:00:00Z"),
      editedAt: null, deleted: false, own: false, visibility: "VISIBLE",
    }],
  };

  function reviewFetch(canModerate: boolean) {
    return fetchRoutes({
      "/review-threads": () => jsonResponse({ threads: [thread], writesEnabled: false, revisionId: "rev-1", callerUserId: "u3", ownerUserId: "u2", canModerate }),
      "/api/documents/": () => jsonResponse({ notifications: [] }),
    });
  }

  it("shows a member the discussion without moderation or following controls", async () => {
    vi.stubGlobal("fetch", reviewFetch(false));
    await act(async () => root.render(
      <OwnerReviewPanel documentId="d1" revisionId="rev-1" markdown="hello"><p>body</p></OwnerReviewPanel>,
    ));
    await settle();
    expect(document.body.textContent).toContain("hello");
    expect(document.querySelector('[aria-label="Resolve"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Follow replies");
  });

  it("gives the creator or an admin the moderation controls", async () => {
    vi.stubGlobal("fetch", reviewFetch(true));
    await act(async () => root.render(
      <OwnerReviewPanel documentId="d1" revisionId="rev-1" markdown="hello"><p>body</p></OwnerReviewPanel>,
    ));
    await settle();
    expect(document.querySelector('[aria-label="Resolve"]')).not.toBeNull();
  });
});
