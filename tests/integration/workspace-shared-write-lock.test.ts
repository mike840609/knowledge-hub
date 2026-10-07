import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mariadb, { type Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource, DEFAULT_HUB_SOURCE_NAME } from "@/modules/sources/application/ensure-default-hub-source";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { createSourceFixture, fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";
import { uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Workspace shared write lock design (2026-10-07): content and import writers hold the
 * Workspace row LOCK IN SHARE MODE; governance keeps FOR UPDATE. A held lock is
 * simulated by the real guard inside a transaction left open, as a long folder Apply
 * holds it. Waiting connections use a 1-second lock wait so a blocked call fails fast
 * instead of after MariaDB's default 50 seconds.
 */
let pool: Pool;
let waiterPool: Pool;

beforeAll(() => {
  const config = databaseConfig("test");
  pool = createDatabasePool(config);
  waiterPool = mariadb.createPool({
    host: config.host, port: config.port, user: config.user, password: config.password, database: config.database,
    connectionLimit: 4, timezone: "Z", bigIntAsNumber: true,
    initSql: "SET SESSION innodb_lock_wait_timeout = 1",
  });
});
afterAll(async () => {
  await waiterPool.end();
  await pool.end();
});

/** Runs `hold` inside an open transaction until `release()` is called. */
function holdOpen(hold: (repositories: Parameters<Parameters<MariaDbUnitOfWork["run"]>[0]>[0]) => Promise<void>) {
  let release!: () => void;
  let held!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { held = resolve; });
  const done = new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await hold(repositories);
    held();
    await released;
  });
  return { ready, release, done };
}

function saveNote(sourceId: string, title: string) {
  return new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(waiterPool))
    .createDocument(fixtureCaller(), { sourceId, parentId: null, title, markdown: "body", metadata: {} });
}

async function countTitled(sourceId: string, title: string): Promise<number> {
  const rows = await pool.query<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM knowledge_revisions r JOIN knowledge_documents d ON d.current_revision_id = r.id WHERE d.source_id = ? AND r.title = ?",
    [sourceId, title],
  );
  return Number(rows[0].n);
}

/** A second, folder-synced Source in the same Workspace, as a running import would have. */
async function addFolderSource(workspaceId: string): Promise<{ source: { id: string }; workspaceId: string }> {
  const now = new Date();
  const source = { id: uuidv7(), name: "Synced folder", workspaceId, sourceType: "FOLDER_SYNC" as const, ownership: "SOURCE_MANAGED" as const, status: "ACTIVE" as const,
    syncVersion: 0, createdBy: fixtureIdentity.id, updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now };
  await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.insert(source));
  return { source, workspaceId };
}

describe("writers share the workspace lock", () => {
  it("lets a note save in another source while an import holds its source and the workspace", async () => {
    const hub = await createSourceFixture(pool);
    const folder = await addFolderSource(hub.workspaceId);
    // As Apply does: its own Source exclusive, then the Workspace as a writer.
    const importing = holdOpen(async (repositories) => {
      await repositories.sources.lockById(folder.source.id);
      await lockWorkspaceForMutation(repositories, fixtureCaller(), folder.workspaceId, "source-import");
    });
    await importing.ready;
    try {
      await expect(saveNote(hub.source.id, "Saved during import")).resolves.toMatchObject({ documentId: expect.any(String) });
      expect(await countTitled(hub.source.id, "Saved during import")).toBe(1);
    } finally {
      importing.release();
      await importing.done;
    }
  });

  it("still queues writes to the same source behind each other", async () => {
    const fixture = await createSourceFixture(pool);
    const writing = holdOpen(async (repositories) => {
      await repositories.sources.lockById(fixture.source.id);
      await lockWorkspaceForMutation(repositories, fixtureCaller(), fixture.workspaceId, "content-write");
    });
    await writing.ready;
    try {
      await expect(saveNote(fixture.source.id, "Same source")).rejects.toBeDefined();
      expect(await countTitled(fixture.source.id, "Same source")).toBe(0);
    } finally {
      writing.release();
      await writing.done;
    }
    await expect(saveNote(fixture.source.id, "Same source")).resolves.toBeDefined();
  });
});

describe("governance still waits for writers", () => {
  it("cannot archive while a write is in flight, and refuses writes once archived", async () => {
    const fixture = await createSourceFixture(pool);
    const archive = () => new TeamWorkspaceService(new MariaDbUnitOfWork(waiterPool)).archiveTeamWorkspace(fixtureCaller(), fixture.workspaceId);
    const lifecycle = async () => (await pool.query<{ s: string }[]>("SELECT lifecycle_state AS s FROM workspaces WHERE id = ?", [fixture.workspaceId]))[0].s;

    const writing = holdOpen(async (repositories) => {
      await lockWorkspaceForMutation(repositories, fixtureCaller(), fixture.workspaceId, "content-write");
    });
    await writing.ready;
    try {
      await expect(archive()).rejects.toBeDefined();
      expect(await lifecycle()).toBe("ACTIVE");
    } finally {
      writing.release();
      await writing.done;
    }

    await archive();
    expect(await lifecycle()).toBe("ARCHIVED");
    await expect(saveNote(fixture.source.id, "After archive")).rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
    expect(await countTitled(fixture.source.id, "After archive")).toBe(0);
  });
});

describe("the check-then-insert that stays exclusive", () => {
  it("creates exactly one default Hub source when two first requests race", async () => {
    const fixture = await createSourceFixture(pool);
    // Each request pauses right after its "does it exist?" read, for up to 1.5 s, until the
    // other has read too. Under the exclusive lock the other is still waiting on the
    // Workspace row and never reads, so the pause times out and only one request inserts.
    // Under a shared lock both read "none" and both insert, and this test fails.
    let reads = 0;
    let bothRead!: () => void;
    const rendezvous = new Promise<void>((resolve) => { bothRead = resolve; });
    const racing = {
      run: (work: Parameters<MariaDbUnitOfWork["run"]>[0]) => new MariaDbUnitOfWork(pool).run((repositories) => work({
        ...repositories,
        sourcePolicy: new Proxy(repositories.sourcePolicy, {
          get(target, key, receiver) {
            if (key !== "listByWorkspaceId") return Reflect.get(target, key, receiver);
            return async (workspaceId: string) => {
              const listed = await target.listByWorkspaceId(workspaceId);
              reads += 1;
              if (reads === 2) bothRead();
              await Promise.race([rendezvous, new Promise((resolve) => setTimeout(resolve, 1500))]);
              return listed;
            };
          },
        }),
      })),
    } as unknown as MariaDbUnitOfWork;

    const ids = await Promise.all([
      ensureDefaultHubSource(racing, fixtureCaller(), fixture.workspaceId),
      ensureDefaultHubSource(racing, fixtureCaller(), fixture.workspaceId),
    ]);
    const rows = await pool.query<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM knowledge_sources WHERE workspace_id = ? AND source_type = 'HUB' AND name = ? AND status = 'ACTIVE'",
      [fixture.workspaceId, DEFAULT_HUB_SOURCE_NAME],
    );
    expect(Number(rows[0].n)).toBe(1);
    expect(ids[0]).toBe(ids[1]);
  });
});
