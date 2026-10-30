import { expect, test, type Browser, type BrowserContext, type Page } from "./fixtures/test";
import { phase3Origin, phase3UserId, type Phase3Persona } from "./fixtures/phase3-identities";
import { stageReadingFolder } from "./fixtures/folder-reading";
import { chooseOption } from "./fixtures/select-menu";

/**
 * Team space publishing, end to end, through the real production build and
 * fixed trusted server personas. Mike owns the team and publishes a synced
 * folder; Ann joins it with her own copy of the same repo; nothing the team
 * shows is ever written by a browser-supplied identity.
 *
 * The cases are serial because they are one workflow: the publication,
 * discussion and membership state built by one is what the next asserts on.
 */

type Session = { context: BrowserContext; page: Page };
type PublicationItem = {
  publication: { id: string; sourceId: string; name: string; kind: string; status: "ACTIVE" | "ARCHIVED" };
  creatorName: string;
  canJoin: boolean;
  canManage: boolean;
  ownContribution: { userId: string; leftAt: string | null } | null;
};
type Notice = { code: string; maintainerName?: string; maintainerUserId?: string; sourcePath?: string };
type ApplyResult = { sourceId: string; runId: string | null; publicationNotices?: Notice[] };
type Peek = { title: string; markdown: string; revisionId: string; status: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED" };
type ThreadView = { id: string; comments: Array<{ body: string }> };

const TEAM_NAME = `Team publishing ${Date.now()}`;
const PUBLICATION_NAME = "HCM KM 設計";
const MIKE_FOLDER = "HCM KM 設計";
const ANN_FOLDER = "Ann HCM Copy";
const GUIDE_COMMENT = "Ann's team review observation";
const REFERENCE_COMMENT = "Ann's reference discussion";

const MIKE = "owner" as Phase3Persona;
const ANN = "editor" as Phase3Persona;
const ADMIN = "admin" as Phase3Persona;

let teamId = "";
let mikePersonalId = "";
let annPersonalId = "";
let publicationId = "";
let publicationSourceId = "";
let mikeSourceId = "";
let annSourceId = "";
let guideDocumentId = "";
let referenceDocumentId = "";
let annNotesDocumentId = "";
let mike: Session;
let ann: Session;
let admin: Session;

async function openSession(browser: Browser, persona: Phase3Persona): Promise<Session> {
  const context = await browser.newContext({ baseURL: phase3Origin(persona), viewport: { width: 1440, height: 900 } });
  return { context, page: await context.newPage() };
}

async function personalWorkspaceId(session: Session): Promise<string> {
  const response = await session.context.request.get("/api/workspaces");
  expect(response.ok()).toBe(true);
  const body = await response.json() as { items: Array<{ id: string; type: string }> };
  const personal = body.items.find((item) => item.type === "PERSONAL");
  if (!personal) throw new Error("The fixed persona has no personal workspace.");
  return personal.id;
}

async function addMember(actor: Session, userId: string, role: string): Promise<void> {
  const response = await actor.context.request.post(`/api/workspaces/${teamId}/members`, { data: { userId, role } });
  expect(response.ok()).toBe(true);
}

async function expandSource(page: Page, name: string): Promise<void> {
  const header = page.getByRole("button", { name, exact: true });
  await expect(header).toBeVisible();
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
}

/** Stage and apply one folder snapshot as its owner, returning the Apply response. */
async function syncFolder(session: Session, input: {
  workspaceId: string;
  sourceId?: string;
  sourceName: string;
  fixture: string;
}): Promise<{ snapshotId: string; apply: ApplyResult }> {
  const snapshotId = await stageReadingFolder(session.context.request, input);
  await session.page.goto(`/w/${input.workspaceId}/sources/imports/${snapshotId}`);
  await expect(session.page.getByRole("heading", { name: "Import preview" })).toBeVisible();
  const applied = session.page.waitForResponse((response) =>
    response.url().endsWith(`/api/source-imports/${snapshotId}/apply`) && response.request().method() === "POST");
  await session.page.getByRole("button", { name: "Apply changes" }).click();
  const response = await applied;
  expect(response.ok()).toBe(true);
  const apply = await response.json() as ApplyResult;
  await expect(session.page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
  await expect(session.page.getByRole("heading", { name: "Folder synced" })).toBeVisible();
  return { snapshotId, apply };
}

async function publications(includeArchived = false): Promise<PublicationItem[]> {
  const response = await mike.context.request.get(
    `/api/workspaces/${teamId}/publications${includeArchived ? "?includeArchived=true" : ""}`);
  expect(response.ok()).toBe(true);
  return await response.json() as PublicationItem[];
}

async function peek(session: Session, documentId: string): Promise<Peek> {
  const response = await session.context.request.get(`/api/documents/${documentId}/peek?brief`);
  expect(response.ok()).toBe(true);
  return await response.json() as Peek;
}

async function threads(session: Session, documentId: string): Promise<ThreadView[]> {
  const response = await session.context.request.get(`/api/documents/${documentId}/review-threads`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { threads: ThreadView[] }).threads;
}

/** The source and document ids a team tree row links to. */
async function treeAddress(page: Page, label: string): Promise<{ sourceId: string; documentId: string }> {
  const href = await page.getByRole("treeitem", { name: label, exact: true }).getByRole("link").getAttribute("href");
  if (!href) throw new Error(`The team tree has no link for ${label}.`);
  const parts = new URL(href, "http://127.0.0.1").pathname.split("/");
  return { sourceId: parts[4]!, documentId: parts[5]! };
}

/**
 * Start a discussion on a paragraph. A document with no discussions yet has no
 * header entry (that control counts them), so the paragraph's own control is
 * the way in, as it is for the owner's articles.
 */
async function commentOn(page: Page, passage: string, body: string): Promise<void> {
  await page.locator("[data-review-document] p").filter({ hasText: passage }).first().hover();
  const paragraph = page.getByRole("button", { name: /^Comment on paragraph:/ }).first();
  await expect(paragraph).toBeEnabled();
  await paragraph.click();
  const field = page.getByRole("textbox", { name: "Add comment" });
  await expect(field).toBeVisible();
  await field.fill(body);
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.locator("[data-review-thread]").filter({ visible: true }).getByText(body, { exact: true })).toBeVisible();
}

test.describe("team space publishing", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Use the isolated HTTP harness via npm run test:e2e.");

  test.beforeAll(async ({ browser }) => {
    mike = await openSession(browser, MIKE);
    ann = await openSession(browser, ANN);
    admin = await openSession(browser, ADMIN);
    mikePersonalId = await personalWorkspaceId(mike);
    annPersonalId = await personalWorkspaceId(ann);

    const created = await mike.context.request.post("/api/workspaces", { data: { name: TEAM_NAME } });
    expect(created.status()).toBe(201);
    teamId = ((await created.json()) as { id: string }).id;
    // A second OWNER can remove the first; the last direct OWNER may not be removed.
    await addMember(mike, phase3UserId(ADMIN), "OWNER");
    await addMember(mike, phase3UserId(ANN), "EDITOR");
  });

  test.afterAll(async () => {
    await mike?.context.close();
    await ann?.context.close();
    await admin?.context.close();
  });

  test("Mike syncs a folder into My Space and publishes it as a team folder publication", { tag: "@smoke-team" }, async () => {
    const synced = await syncFolder(mike, {
      workspaceId: mikePersonalId, sourceName: MIKE_FOLDER, fixture: "team-hcm-v1",
    });
    mikeSourceId = synced.apply.sourceId;
    expect(mikeSourceId).toBeTruthy();
    expect(synced.apply.publicationNotices ?? []).toHaveLength(0);

    await mike.page.goto(`/w/${mikePersonalId}/knowledge`);
    await expandSource(mike.page, MIKE_FOLDER);
    // A Folder Sync source places its documents under the imported folder's own
    // subfolders; the folder inside the source is the publishable origin. Act on
    // the folder's own header, not the row that contains its whole subtree.
    await mike.page.getByRole("button", { name: "hcm", exact: true }).hover();
    await mike.page.getByRole("button", { name: "Actions for hcm", exact: true }).click();
    await mike.page.getByRole("menuitem", { name: "發佈到團隊", exact: true }).click();

    const dialog = mike.page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "發佈到團隊" })).toBeVisible();
    await chooseOption(dialog.getByLabel("團隊"), teamId);
    await dialog.getByLabel("發佈名稱").fill(PUBLICATION_NAME);
    const published = mike.page.waitForResponse((response) =>
      response.url().endsWith("/api/publications") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "發佈到團隊" }).click();
    expect((await published).status()).toBe(201);
    await expect(dialog).toHaveCount(0);

    const listed = await publications();
    const item = listed.find((candidate) => candidate.publication.name === PUBLICATION_NAME);
    expect(item).toBeDefined();
    expect(item!.creatorName).toBe("Phase3 owner");
    expect(item!.publication.kind).toBe("FOLDER");
    expect(item!.publication.status).toBe("ACTIVE");
    publicationId = item!.publication.id;
    publicationSourceId = item!.publication.sourceId;

    await mike.page.goto(`/w/${teamId}/knowledge`);
    await expect(mike.page.locator("[data-publication-meta]")).toContainText("Phase3 owner");
    await expandSource(mike.page, PUBLICATION_NAME);
    const guide = mike.page.getByRole("treeitem", { name: "HCM Guide", exact: true });
    const reference = mike.page.getByRole("treeitem", { name: "HCM Reference", exact: true });
    await expect(guide).toContainText("由 Phase3 owner 維護");
    await expect(reference).toContainText("由 Phase3 owner 維護");
    const guideAddress = await treeAddress(mike.page, "HCM Guide");
    expect(guideAddress.sourceId).toBe(publicationSourceId);
    guideDocumentId = guideAddress.documentId;
    referenceDocumentId = (await treeAddress(mike.page, "HCM Reference")).documentId;
  });

  test("Ann reads the publication and comments; Mike's Inbox names the comment and opens the team document", { tag: "@smoke-team" }, async () => {
    await ann.page.goto(`/w/${teamId}/knowledge`);
    await expect(ann.page.locator("[data-publication-meta]")).toContainText("Phase3 owner");
    await expandSource(ann.page, PUBLICATION_NAME);
    await expect(ann.page.getByRole("treeitem", { name: "HCM Guide", exact: true })).toContainText("由 Phase3 owner 維護");
    await ann.page.getByRole("treeitem", { name: "HCM Guide", exact: true }).getByRole("link").click();
    await expect(ann.page).toHaveURL(new RegExp(`/w/${teamId}/knowledge/${publicationSourceId}/${guideDocumentId}$`));
    await expect(ann.page.locator("[data-review-document]")).toContainText("Original workflow for HCM KM.");

    await commentOn(ann.page, "Original workflow", GUIDE_COMMENT);
    const created = await threads(ann, guideDocumentId);
    const thread = created.find((candidate) => candidate.comments[0]?.body === GUIDE_COMMENT);
    expect(thread).toBeDefined();

    await mike.page.goto(`/w/${mikePersonalId}/inbox`);
    const inbox = mike.page.getByRole("list", { name: "Inbox discussions" });
    const row = inbox.getByRole("listitem").filter({ hasText: GUIDE_COMMENT });
    await expect(row).toContainText("HCM Guide");
    await row.getByRole("link").click();
    const selected = mike.page.getByRole("region", { name: "Selected discussion" });
    await expect(selected.getByText(GUIDE_COMMENT, { exact: true })).toBeVisible();
    await selected.getByRole("link", { name: "Open document" }).click();
    await expect(mike.page).toHaveURL(new RegExp(`/w/${teamId}/knowledge/${publicationSourceId}/${guideDocumentId}\\?thread=${thread!.id}$`));
    await expect(mike.page.locator("[data-review-thread]").filter({ visible: true }).getByText(GUIDE_COMMENT, { exact: true })).toBeVisible();
  });

  test("Mike's later save reaches the team copy without any team write", { tag: "@smoke-team" }, async () => {
    await syncFolder(mike, {
      workspaceId: mikePersonalId, sourceId: mikeSourceId, sourceName: MIKE_FOLDER, fixture: "team-hcm-v2",
    });
    await expect.poll(async () => (await peek(ann, guideDocumentId)).markdown, { timeout: 20_000 })
      .toContain("Revised in My Space.");
    await ann.page.goto(`/w/${teamId}/knowledge/${publicationSourceId}/${guideDocumentId}`);
    await expect(ann.page.locator("[data-review-document]")).toContainText("Revised in My Space.");
  });

  test("Ann joins with a newer copy: Mike's copy is not overwritten and her new path is created", { tag: "@smoke-team" }, async () => {
    const synced = await syncFolder(ann, {
      workspaceId: annPersonalId, sourceName: ANN_FOLDER, fixture: "team-hcm-ann-v1",
    });
    annSourceId = synced.apply.sourceId;

    await ann.page.goto(`/w/${teamId}/knowledge`);
    const optionsLoaded = ann.page.waitForResponse((response) =>
      response.url().endsWith("/api/publications/options") && response.ok());
    await ann.page.getByRole("button", { name: `${PUBLICATION_NAME} 的發佈操作` }).click();
    await ann.page.getByRole("menuitem", { name: "加入", exact: true }).click();
    await optionsLoaded;
    const joinDialog = ann.page.getByRole("dialog");
    await expect(joinDialog.getByRole("heading", { name: `加入「${PUBLICATION_NAME}」` })).toBeVisible();
    await joinDialog.getByLabel("你的資料夾").click();
    await ann.page.getByRole("option", { name: `${ANN_FOLDER} / hcm` }).click();
    const joined = ann.page.waitForResponse((response) =>
      /\/api\/publications\/[^/]+\/join$/.test(response.url()) && response.request().method() === "POST");
    await joinDialog.getByRole("button", { name: "加入", exact: true }).click();
    const joinBody = await (await joined).json() as { contributionId: string; report: { created: number; notices: Notice[] } };
    expect(joinBody.contributionId).toBeTruthy();
    expect(joinBody.report.created).toBe(1);
    const maintained = joinBody.report.notices.filter((notice) => notice.code === "MAINTAINED_BY_OTHER");
    expect(maintained).toHaveLength(2);
    expect(maintained.every((notice) => notice.maintainerUserId === phase3UserId(MIKE))).toBe(true);
    expect((await peek(ann, guideDocumentId)).markdown).toContain("Revised in My Space.");
    expect((await peek(ann, guideDocumentId)).markdown).not.toContain("Ann's newer copy");

    await ann.page.goto(`/w/${teamId}/knowledge`);
    await expandSource(ann.page, PUBLICATION_NAME);
    const notes = ann.page.getByRole("treeitem", { name: "Ann Notes", exact: true });
    await expect(notes).toContainText("由 Phase3 editor 維護");
    annNotesDocumentId = (await treeAddress(ann.page, "Ann Notes")).documentId;
    expect((await peek(ann, annNotesDocumentId)).markdown).toContain("Ann's own notes.");

    // A later folder sync is where the caller's own preview and result explain
    // that this path belongs to Mike; it must not be applied.
    const snapshotId = await stageReadingFolder(ann.context.request, {
      workspaceId: annPersonalId, sourceId: annSourceId, sourceName: ANN_FOLDER, fixture: "team-hcm-ann-v2",
    });
    await ann.page.goto(`/w/${annPersonalId}/sources/imports/${snapshotId}`);
    await expect(ann.page.getByRole("heading", { name: "Import preview" })).toBeVisible();
    await expect(ann.page.locator('[data-publication-notice="MAINTAINED_BY_OTHER"]').first())
      .toContainText("由 Phase3 owner 維護，你的版本不會更新團隊");
    const applied = ann.page.waitForResponse((response) =>
      response.url().endsWith(`/api/source-imports/${snapshotId}/apply`) && response.request().method() === "POST");
    await ann.page.getByRole("button", { name: "Apply changes" }).click();
    const applyBody = await (await applied).json() as ApplyResult;
    expect((applyBody.publicationNotices ?? []).map((notice) => notice.code)).toContain("MAINTAINED_BY_OTHER");
    await expect(ann.page).toHaveURL(/\/runs\/[0-9a-f-]+$/);

    expect((await peek(ann, guideDocumentId)).markdown).toContain("Revised in My Space.");
    await expect.poll(async () => (await peek(ann, annNotesDocumentId)).markdown)
      .toContain("Ann's own notes, revised.");
  });

  test("an archived team document is reattached by its creator's own path, keeping its discussion", { tag: "@smoke-team" }, async () => {
    await ann.page.goto(`/w/${teamId}/knowledge/${publicationSourceId}/${referenceDocumentId}`);
    await commentOn(ann.page, "Reference material", REFERENCE_COMMENT);
    const referenceThreads = await threads(ann, referenceDocumentId);
    const thread = referenceThreads.find((candidate) => candidate.comments[0]?.body === REFERENCE_COMMENT);
    expect(thread).toBeDefined();

    // Removing the file from the published folder archives the team copy.
    await syncFolder(mike, {
      workspaceId: mikePersonalId, sourceId: mikeSourceId, sourceName: MIKE_FOLDER, fixture: "team-hcm-v3",
    });
    await expect.poll(async () => (await peek(ann, referenceDocumentId)).status).toBe("ARCHIVED");

    // Re-adding the same file restores the same archived original: the fixture
    // keeps its `knowledge_id`, so the import reconciler matches the archived
    // entry by external identity and restores that entry/document. This proves
    // "removed file, then restored original"; the different-original reattach
    // branch is covered by tests/integration/publication-reconcile.test.ts
    // ("re-attaches the same copy for a same-sync delete plus add"). Either way
    // the same team document and its thread survive.
    await syncFolder(mike, {
      workspaceId: mikePersonalId, sourceId: mikeSourceId, sourceName: MIKE_FOLDER, fixture: "team-hcm-v4",
    });
    await expect.poll(async () => (await peek(ann, referenceDocumentId)).status).toBe("ACTIVE");
    expect((await peek(ann, referenceDocumentId)).markdown).toContain("Reference material for the team.");
    const restored = await threads(ann, referenceDocumentId);
    expect(restored.map((candidate) => candidate.id)).toContain(thread!.id);
    expect(restored.find((candidate) => candidate.id === thread!.id)!.comments[0]!.body).toBe(REFERENCE_COMMENT);

    await ann.page.goto(`/w/${teamId}/knowledge`);
    await expandSource(ann.page, PUBLICATION_NAME);
    await expect(ann.page.getByRole("treeitem", { name: "HCM Reference", exact: true })).toContainText("由 Phase3 owner 維護");
  });

  test("removed from the team, Mike's Inbox entry names nothing and opens nothing", { tag: "@smoke-team" }, async () => {
    const removed = await admin.context.request.delete(`/api/workspaces/${teamId}/members/${phase3UserId(MIKE)}`);
    expect(removed.ok()).toBe(true);
    expect((await mike.context.request.get(`/api/workspaces/${teamId}`)).status()).toBe(404);

    await mike.page.goto(`/w/${mikePersonalId}/inbox`);
    await expect(mike.page.getByRole("list", { name: "Inbox discussions" }).getByText("A team discussion")).toHaveCount(0);
    await mike.page.getByRole("tab", { name: "All activity" }).click();
    const activity = mike.page.getByRole("list", { name: "Activity history" });
    const rows = activity.getByRole("listitem").filter({ hasText: "A team discussion" });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("This discussion is no longer available.");
    await expect(rows.first()).not.toContainText("HCM Guide");
    await expect(rows.first()).not.toContainText(GUIDE_COMMENT);
    await expect(rows.first().getByRole("link")).toHaveCount(0);
    await expect(rows.first().getByRole("button", { name: "Mark read" })).toHaveCount(0);

    // Re-added as a member, so the later unpublish case isolates stickiness
    // from lost membership.
    await addMember(admin, phase3UserId(MIKE), "EDITOR");
    expect((await mike.context.request.get(`/api/workspaces/${teamId}`)).status()).toBe(200);
  });

  test("unpublish archives the whole publication and a later save does not resurrect it", { tag: "@smoke-team" }, async () => {
    await mike.page.goto(`/w/${teamId}/knowledge`);
    await mike.page.getByRole("button", { name: `${PUBLICATION_NAME} 的發佈操作` }).click();
    await mike.page.getByRole("menuitem", { name: "取消發佈／封存", exact: true }).click();
    const confirmation = mike.page.getByRole("alertdialog");
    await expect(confirmation).toContainText("封存");
    const unpublished = mike.page.waitForResponse((response) =>
      /\/api\/publications\/[^/]+\/unpublish$/.test(response.url()) && response.request().method() === "POST");
    await confirmation.getByRole("button", { name: "取消發佈", exact: true }).click();
    expect((await unpublished).status()).toBe(204);
    await expect(mike.page.getByRole("button", { name: PUBLICATION_NAME, exact: true })).toHaveCount(0);

    const archived = (await publications(true)).find((candidate) => candidate.publication.id === publicationId);
    expect(archived?.publication.status).toBe("ARCHIVED");
    expect(await publications()).toHaveLength(0);

    await syncFolder(mike, {
      workspaceId: mikePersonalId, sourceId: mikeSourceId, sourceName: MIKE_FOLDER, fixture: "team-hcm-v5",
    });
    // Consumption is asynchronous; give a wrong implementation one scheduling
    // window to restore it before asserting the archived state is sticky.
    await mike.page.waitForTimeout(1_500);
    expect((await publications(true)).find((candidate) => candidate.publication.id === publicationId)?.publication.status)
      .toBe("ARCHIVED");
    expect(await publications()).toHaveLength(0);
    // The whole publication source is archived; its document rows keep their own
    // ACTIVE lifecycle, as any archived source's content does, and visibility is
    // derived from the source.
    expect((await peek(ann, guideDocumentId)).sourceStatus).toBe("ARCHIVED");
    await mike.page.goto(`/w/${teamId}/knowledge`);
    await expect(mike.page.getByRole("button", { name: PUBLICATION_NAME, exact: true })).toHaveCount(0);
  });
});
