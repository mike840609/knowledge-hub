import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mariadb, { type Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource, DEFAULT_HUB_SOURCE_NAME } from "@/modules/sources/application/ensure-default-hub-source";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { createSourceFixture, fixtureCaller, fixtureIdentity, secondFixtureIdentity } from "../fixtures/knowledge";
import { uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Workspace shared write lock design (2026-10-07): content and import writers hold the
 * Workspace row LOCK IN SHARE MODE; governance keeps FOR UPDATE. A held lock is
 * simulated by the real guard inside a transaction left open, as a long folder Apply
 * holds it. Waiting connections use a 1-second lock wait so a blocked call fails fast
 * instead of after MariaDB's default 50 seconds.
 */
/** A lock wait that timed out: WORKSPACE_BUSY once #135 lands, IMPORT_APPLY_RETRYABLE before it. */
const LOCK_WAIT_CODE = expect.stringMatching(/^(WORKSPACE_BUSY|IMPORT_APPLY_RETRYABLE)$/);

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
      await expect(saveNote(fixture.source.id, "Same source")).rejects.toMatchObject({ code: LOCK_WAIT_CODE });
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
      await expect(archive()).rejects.toMatchObject({ code: LOCK_WAIT_CODE });
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

describe("governance behind a long import", () => {
  it("gives up after a few seconds, releasing the writers queued behind it", async () => {
    const hub = await createSourceFixture(pool);
    const folder = await addFolderSource(hub.workspaceId);
    const importing = holdOpen(async (repositories) => {
      await repositories.sources.lockById(folder.source.id);
      await lockWorkspaceForMutation(repositories, fixtureCaller(), hub.workspaceId, "source-import");
    });
    await importing.ready;
    try {
      // Both use the default 50 s session lock wait: only the statement's own WAIT bounds them.
      const started = performance.now();
      const archive = new TeamWorkspaceService(new MariaDbUnitOfWork(pool)).archiveTeamWorkspace(fixtureCaller(), hub.workspaceId)
        .then(() => "archived", (error: { code?: string }) => ({ code: error.code, seconds: (performance.now() - started) / 1000 }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Queued behind the pending FOR UPDATE, not behind the import.
      const save = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool))
        .createDocument(fixtureCaller(), { sourceId: hub.source.id, parentId: null, title: "Behind governance", markdown: "body", metadata: {} });
      const outcome = await archive;
      expect(outcome).toMatchObject({ code: "WORKSPACE_BUSY" });
      expect((outcome as { seconds: number }).seconds).toBeLessThan(15);
      await expect(save).resolves.toMatchObject({ documentId: expect.any(String) });
      expect(await countTitled(hub.source.id, "Behind governance")).toBe(1);
    } finally {
      importing.release();
      await importing.done;
    }
  }, 30_000);
});

describe("the default Hub source", () => {
  it("creates exactly one when two first requests race", async () => {
    const fixture = await createSourceFixture(pool);
    // Each existence check waits up to 1.5 s for the next one, then both go on together.
    // The first, shared look-up pairs up and both find nothing. In the create step, under
    // FOR UPDATE, the other request is still waiting on the Workspace row and never
    // reads, so the wait times out and only one inserts; the other then re-reads and
    // reuses it. Were that step shared, both would read "none" together and both insert.
    let waiting: (() => void) | null = null;
    const racing = {
      run: (work: Parameters<MariaDbUnitOfWork["run"]>[0]) => new MariaDbUnitOfWork(pool).run((repositories) => work({
        ...repositories,
        sourcePolicy: new Proxy(repositories.sourcePolicy, {
          get(target, key, receiver) {
            if (key !== "listByWorkspaceId") return Reflect.get(target, key, receiver);
            return async (workspaceId: string) => {
              const listed = await target.listByWorkspaceId(workspaceId);
              if (waiting) {
                const release = waiting;
                waiting = null;
                release();
              } else {
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(() => { waiting = null; resolve(); }, 1500);
                  waiting = () => { clearTimeout(timer); resolve(); };
                });
              }
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

  it("is found without the exclusive lock, so New document works while an import holds the workspace", async () => {
    const fixture = await createSourceFixture(pool);
    const hubId = await ensureDefaultHubSource(new MariaDbUnitOfWork(pool), fixtureCaller(), fixture.workspaceId);
    const folder = await addFolderSource(fixture.workspaceId);
    const importing = holdOpen(async (repositories) => {
      await repositories.sources.lockById(folder.source.id);
      await lockWorkspaceForMutation(repositories, fixtureCaller(), fixture.workspaceId, "source-import");
    });
    await importing.ready;
    try {
      // The waiting pool gives up after 1 s: an exclusive look-up would fail here.
      await expect(ensureDefaultHubSource(new MariaDbUnitOfWork(waiterPool), fixtureCaller(), fixture.workspaceId)).resolves.toBe(hubId);
    } finally {
      importing.release();
      await importing.done;
    }
  });
});

describe("what a writer reads after waiting", () => {
  it("sees a revocation committed while it waited, even after reading membership before the lock", async () => {
    // The guarantee rests on READ COMMITTED (transaction.ts): under REPEATABLE READ an
    // earlier plain read would pin the writer to the pre-revocation membership.
    const fixture = await createSourceFixture(pool);
    const governance = await pool.getConnection();
    let readBeforeLock!: () => void;
    const hasRead = new Promise<void>((resolve) => { readBeforeLock = resolve; });
    let goLock!: () => void;
    const mayLock = new Promise<void>((resolve) => { goLock = resolve; });
    try {
      // Order: the writer reads membership (still a member), then governance holds the row
      // and deletes the membership, then the writer asks for the lock and waits behind it.
      const write = new MariaDbUnitOfWork(pool).run(async (repositories) => {
        expect(await repositories.workspaceMemberships.find(fixture.workspaceId, secondFixtureIdentity.id)).not.toBeNull();
        readBeforeLock();
        await mayLock;
        await lockWorkspaceForMutation(repositories, fixtureCaller(secondFixtureIdentity), fixture.workspaceId, "content-write");
      });
      // Attach the rejection handler before releasing either barrier: CI may finish
      // the writer before the test resumes after governance commits.
      const denied = expect(write).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
      await hasRead;
      await governance.beginTransaction();
      await governance.query("SELECT id FROM workspaces WHERE id = ? FOR UPDATE", [fixture.workspaceId]);
      await governance.query("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?", [fixture.workspaceId, secondFixtureIdentity.id]);
      goLock();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await governance.commit();
      await denied;
    } finally {
      governance.release();
    }
  });
});
