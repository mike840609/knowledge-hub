import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createSourceFixture, fixtureCaller, fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";

let pool: Pool;
const now = new Date("2026-09-12T10:00:00.000Z");
const clock = () => new Date(now);

type InitialSnapshotRow = { source_id: string | null; based_on_version: number | null; proposed_source_name: string | null; state: string };
type ResyncSnapshotRow = { workspace_id: string; source_id: string; based_on_version: number; proposed_source_name: string | null };
type AssetStageRow = { entry_type: string; upload_status: string; asset_content_hash: string };
type MarkdownStageRow = { upload_status: string; raw_markdown: string | null; source_file_hash: string; diagnostics: unknown };

beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await pool.query("DELETE FROM source_import_snapshot_entries");
  await pool.query("DELETE FROM source_import_snapshots");
});

const markdownManifest = (path = "README.md", size = 7): ImportManifestEntry[] => [{ uploadKey: "m1", relativePath: path, kind: "MARKDOWN", size }];
const assetManifest = (path = "image.png"): ImportManifestEntry[] => [{
  uploadKey: "a1", relativePath: path, kind: "ASSET", size: 10,
  contentHash: "a".repeat(64), mimeType: "image/png", lastModified: new Date("2026-09-12T09:00:00.000Z"),
}];

function services() {
  const uow = new MariaDbUnitOfWork(pool);
  return {
    create: new CreateFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
    upload: new UploadFolderImportEntriesService(uow, { limits: DEFAULT_IMPORT_LIMITS, now: clock }),
  };
}

async function insertReady(workspaceId: string, createdBy: string): Promise<void> {
  const id = uuidv7();
  const summary = { documents: { added:0,updated:0,moved:0,renamed:0,archived:0,restored:0,unchanged:0 }, folders: { added:0,archived:0,restored:0 }, assets: { added:0,updated:0,removed:0,unchanged:0 }, warnings:0, blockers:0, affectedDocuments:0, changed:false };
  const plan = { planVersion:"phase2:v1", sourceBinding:{workspaceId,sourceId:null,basedOnVersion:null}, folders:{create:[],restore:[],archive:[]}, documents:{create:[],restore:[],move:[],revise:[],archive:[],updateLocator:[]}, assets:{upsert:[],remove:[]}, ordering:[], preview:[], summary };
  await pool.query(
    `INSERT INTO source_import_snapshots (id,workspace_id,source_id,based_on_version,created_by,root_name,proposed_source_name,adapter_type,adapter_version,plan_version,state,manifest_hash,snapshot_hash,plan_hash,has_blockers,summary,plan,created_at,finalized_at,expires_at)
     VALUES (?, ?, NULL, NULL, ?, 'wiki', 'Wiki', 'GENERIC_MARKDOWN_FOLDER', 'phase2:v1', 'phase2:v1', 'READY', ?, ?, ?, FALSE, ?, ?, ?, ?, ?)`,
    [id, workspaceId, createdBy, "a".repeat(64), "b".repeat(64), "c".repeat(64), JSON.stringify(summary), JSON.stringify(plan), now, now, new Date(now.getTime()+30*60_000)],
  );
}

describe("Phase 2 BUILDING import sessions", () => {
  it("creates an initial BUILDING snapshot without creating a Source", async () => {
    const fixture = await createSourceFixture(pool);
    const before = Number((await pool.query<{ count: unknown }[]>("SELECT COUNT(*) AS count FROM knowledge_sources"))[0].count);
    const result = await services().create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest: markdownManifest(),
    });
    expect(result.state).toBe("BUILDING");
    const row = (await pool.query<InitialSnapshotRow[]>("SELECT source_id,based_on_version,proposed_source_name,state FROM source_import_snapshots WHERE id=?", [result.snapshotId]))[0];
    expect(row).toMatchObject({ source_id: null, based_on_version: null, proposed_source_name: "Imported Wiki", state: "BUILDING" });
    expect(Number((await pool.query<{ count: unknown }[]>("SELECT COUNT(*) AS count FROM knowledge_sources"))[0].count)).toBe(before);
  });

  it("creates resync from only sourceId and derives workspace/version while enforcing source authority", async () => {
    const fixture = await createSourceFixture(pool, { managed: true });
    await pool.query("UPDATE knowledge_sources SET sync_version=7 WHERE id=?", [fixture.source.id]);
    const result = await services().create.createResync(fixtureCaller(), { sourceId: fixture.source.id, rootName: "wiki", manifest: markdownManifest() });
    const row = (await pool.query<ResyncSnapshotRow[]>("SELECT workspace_id,source_id,based_on_version,proposed_source_name FROM source_import_snapshots WHERE id=?", [result.snapshotId]))[0];
    expect(String(row.workspace_id)).toBe(fixture.workspaceId);
    expect(String(row.source_id)).toBe(fixture.source.id);
    expect(Number(row.based_on_version)).toBe(7);
    expect(row.proposed_source_name).toBeNull();

    const hub = await createSourceFixture(pool);
    await expect(services().create.createResync(fixtureCaller(), { sourceId: hub.source.id, rootName: "wiki", manifest: markdownManifest() })).rejects.toMatchObject({ code: "SOURCE_IMPORT_NOT_ALLOWED" });
    await pool.query("UPDATE knowledge_sources SET status='ARCHIVED', archived_by=?, archived_at=?, updated_by=? WHERE id=?", [fixtureIdentity.id, now, fixtureIdentity.id, fixture.source.id]);
    await expect(services().create.createResync(fixtureCaller(), { sourceId: fixture.source.id, rootName: "wiki", manifest: markdownManifest() })).rejects.toMatchObject({ code: "SOURCE_IMPORT_NOT_ALLOWED" });
  });

  it("requires workspace membership and only the snapshot creator may upload", async () => {
    const fixture = await createSourceFixture(pool);
    const outsider = { ...secondFixtureIdentity, id: uuidv7(), emp_id: `OUT-${uuidv7()}` };
    await new MariaDbUnitOfWork(pool).run(({ users }) => users.upsertIdentity(outsider));
    await expect(services().create.createInitial(fixtureCaller(outsider), { workspaceId: fixture.workspaceId, sourceName: "No", rootName: "wiki", manifest: markdownManifest() })).rejects.toThrow();

    const created = await services().create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName: "Wiki", rootName: "wiki", manifest: markdownManifest() });
    await expect(services().upload.upload(fixtureCaller(secondFixtureIdentity), { snapshotId: created.snapshotId, entries: [{ uploadKey: "m1", bytes: new TextEncoder().encode("# Hello") }] })).rejects.toThrow();
  });

  it("enforces active snapshot quotas while ignoring expired rows", async () => {
    const fixture = await createSourceFixture(pool);
    const create = services().create;
    for (let i=0;i<3;i+=1) await create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName: `Wiki ${i}`, rootName: "wiki", manifest: markdownManifest(`a${i}.md`) });
    await expect(create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName: "Fourth", rootName: "wiki", manifest: markdownManifest("four.md") })).rejects.toMatchObject({ code: "IMPORT_BUILDING_QUOTA_EXCEEDED" });
    await pool.query("UPDATE source_import_snapshots SET expires_at=? WHERE state='BUILDING'", [new Date(now.getTime()-1)]);
    await expect(create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName: "Allowed", rootName: "wiki", manifest: markdownManifest("ok.md") })).resolves.toMatchObject({ state: "BUILDING" });

    await pool.query("DELETE FROM source_import_snapshots");
    for (let i=0;i<10;i+=1) await insertReady(fixture.workspaceId, fixtureIdentity.id);
    await expect(create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName: "Blocked", rootName: "wiki", manifest: markdownManifest() })).rejects.toMatchObject({ code: "IMPORT_READY_QUOTA_EXCEEDED" });
  });

  it("validates manifest classification and exact resource limits", async () => {
    const fixture = await createSourceFixture(pool);
    const create = services().create;
    const tooMany = Array.from({ length: DEFAULT_IMPORT_LIMITS.maxManifestEntries + 1 }, (_, i): ImportManifestEntry => ({ uploadKey:`m${i}`,relativePath:`${i}.md`,kind:"MARKDOWN",size:1 }));
    await expect(create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName:"Wiki",rootName:"wiki",manifest:tooMany })).rejects.toMatchObject({ code:"IMPORT_LIMIT_EXCEEDED" });
    await expect(create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName:"Wiki",rootName:"wiki",manifest:markdownManifest("big.md",DEFAULT_IMPORT_LIMITS.maxMarkdownFileBytes+1) })).rejects.toMatchObject({ code:"IMPORT_LIMIT_EXCEEDED" });
    const total = Array.from({ length: 2 }, (_, i): ImportManifestEntry => ({ uploadKey:`m${i}`,relativePath:`${i}.md`,kind:"MARKDOWN",size:DEFAULT_IMPORT_LIMITS.maxMarkdownTotalBytes/2+1 }));
    await expect(create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName:"Wiki",rootName:"wiki",manifest:total })).rejects.toMatchObject({ code:"IMPORT_LIMIT_EXCEEDED" });
    const mislabeled = [{ uploadKey:"x",relativePath:"image.png",kind:"MARKDOWN",size:10 }] as unknown as ImportManifestEntry[];
    await expect(create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName:"Wiki",rootName:"wiki",manifest:mislabeled })).rejects.toMatchObject({ code:"INVALID_ASSET_MANIFEST" });
  });

  it("stores asset manifest rows as RECEIVED without binary upload", async () => {
    const fixture = await createSourceFixture(pool);
    const created = await services().create.createInitial(fixtureCaller(), { workspaceId: fixture.workspaceId, sourceName:"Wiki",rootName:"wiki",manifest:assetManifest() });
    const row = (await pool.query<AssetStageRow[]>("SELECT entry_type,upload_status,asset_content_hash FROM source_import_snapshot_entries WHERE snapshot_id=?", [created.snapshotId]))[0];
    expect(row).toMatchObject({ entry_type:"ASSET", upload_status:"RECEIVED", asset_content_hash:"a".repeat(64) });
  });

  it("uploads Markdown raw bytes idempotently and rejects conflicting retries/batch limits", async () => {
    const fixture = await createSourceFixture(pool);
    const { create, upload } = services();
    const created = await create.createInitial(fixtureCaller(), { workspaceId:fixture.workspaceId,sourceName:"Wiki",rootName:"wiki",manifest:markdownManifest() });
    const bytes = new TextEncoder().encode("# Hello");
    await expect(upload.upload(fixtureCaller(), { snapshotId:created.snapshotId,entries:[{uploadKey:"m1",bytes}] })).resolves.toMatchObject({ accepted:1, idempotent:0 });
    await expect(upload.upload(fixtureCaller(), { snapshotId:created.snapshotId,entries:[{uploadKey:"m1",bytes}] })).resolves.toMatchObject({ accepted:0, idempotent:1 });
    await expect(upload.upload(fixtureCaller(), { snapshotId:created.snapshotId,entries:[{uploadKey:"m1",bytes:new TextEncoder().encode("changed")}] })).rejects.toMatchObject({ code:"UPLOAD_ENTRY_CONFLICT" });

    const tooMany = Array.from({ length:DEFAULT_IMPORT_LIMITS.maxUploadBatchFiles+1 },(_,i)=>({uploadKey:`x${i}`,bytes:new Uint8Array()}));
    await expect(upload.upload(fixtureCaller(), { snapshotId:created.snapshotId,entries:tooMany })).rejects.toMatchObject({ code:"IMPORT_LIMIT_EXCEEDED" });
  });

  it("persists invalid UTF-8 as RECEIVED blocker with no raw Markdown", async () => {
    const fixture = await createSourceFixture(pool);
    const { create, upload } = services();
    const created = await create.createInitial(fixtureCaller(), { workspaceId:fixture.workspaceId,sourceName:"Wiki",rootName:"wiki",manifest:markdownManifest("README.md", 2) });
    const bytes = new Uint8Array([0xc3,0x28]);
    await upload.upload(fixtureCaller(), { snapshotId:created.snapshotId,entries:[{uploadKey:"m1",bytes}] });
    const row = (await pool.query<MarkdownStageRow[]>("SELECT upload_status,raw_markdown,source_file_hash,diagnostics FROM source_import_snapshot_entries WHERE snapshot_id=?", [created.snapshotId]))[0];
    expect(row.upload_status).toBe("RECEIVED");
    expect(row.raw_markdown).toBeNull();
    expect(row.source_file_hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    const diagnostics = typeof row.diagnostics === "string" ? JSON.parse(row.diagnostics) : row.diagnostics;
    expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ severity:"BLOCKING", code:"INVALID_MARKDOWN_ENCODING" })]));
  });

  it("rejects uploads after BUILDING expiry", async () => {
    const fixture = await createSourceFixture(pool);
    const { create, upload } = services();
    const created = await create.createInitial(fixtureCaller(), { workspaceId:fixture.workspaceId,sourceName:"Wiki",rootName:"wiki",manifest:markdownManifest() });
    await pool.query("UPDATE source_import_snapshots SET expires_at=? WHERE id=?", [new Date(now.getTime()-1),created.snapshotId]);
    await expect(upload.upload(fixtureCaller(), { snapshotId:created.snapshotId,entries:[{uploadKey:"m1",bytes:new TextEncoder().encode("# hi")}] })).rejects.toMatchObject({ code:"IMPORT_SNAPSHOT_EXPIRED" });
  });

  it("serializes concurrent session creation per creator within the BUILDING quota", async () => {
    const fixture = await createSourceFixture(pool);
    const create = services().create;
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => create.createInitial(fixtureCaller(), {
      workspaceId: fixture.workspaceId, sourceName: `Race ${index}`, rootName: "wiki", manifest: markdownManifest(`race${index}.md`),
    })));
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(DEFAULT_IMPORT_LIMITS.maxBuildingSnapshotsPerUser);
    expect(rejected).toHaveLength(5 - DEFAULT_IMPORT_LIMITS.maxBuildingSnapshotsPerUser);
    for (const outcome of rejected) {
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({ code: "IMPORT_BUILDING_QUOTA_EXCEEDED" });
    }
    const building = Number((await pool.query<{ count: unknown }[]>("SELECT COUNT(*) AS count FROM source_import_snapshots WHERE created_by=? AND state='BUILDING'", [fixtureIdentity.id]))[0].count);
    expect(building).toBe(DEFAULT_IMPORT_LIMITS.maxBuildingSnapshotsPerUser);
  });
});