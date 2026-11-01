import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mariadb, { type Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { SESSION_ISOLATION_SQL } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { PublicationService } from "@/modules/sources/application/publication-service";
import type { SourceRepositories } from "@/modules/sources/ports/unit-of-work";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

/**
 * The plan's Transaction and Concurrency Rules: a publication write holds the
 * Team Workspace shared lock (Source → Workspace), while archive/restore keeps
 * FOR UPDATE. These tests hold one side of that pair in an open transaction and
 * prove the other side waits; the waiter pool uses a 1 s lock wait so a blocked
 * call fails fast instead of after MariaDB's default 50 s.
 */
let fixture: PublicationFixture;
let waiterPool: Pool;
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

beforeAll(async () => {
  fixture = await createPublicationFixture();
  // The fixture owns an isolated database; the waiter pool must point at the
  // same one, not at the shared test database in the environment.
  const rows = await fixture.pool.query<{ name: string }[]>("SELECT DATABASE() AS name");
  const config = databaseConfig("test");
  waiterPool = mariadb.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: String(rows[0]?.name),
    connectionLimit: 4,
    timezone: "Z",
    bigIntAsNumber: true,
    initSql: [SESSION_ISOLATION_SQL, "SET SESSION innodb_lock_wait_timeout = 1"],
  });
});
afterAll(async () => {
  await waiterPool.end();
  await fixture.dispose();
});

function waiterUow(): MariaDbUnitOfWork {
  return new MariaDbUnitOfWork(waiterPool);
}

/** Runs `hold` inside an open transaction until `release()` is called. */
function holdOpen(hold: (repositories: SourceRepositories) => Promise<void>) {
  let release!: () => void;
  let held!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { held = resolve; });
  const done = fixture.uow.run(async (repositories) => {
    await hold(repositories);
    held();
    await released;
  });
  return { ready, release, done };
}

async function createTeam(): Promise<string> {
  const teamId = uuidv7();
  const now = new Date();
  await fixture.uow.run(async (repositories) => {
    await repositories.workspaces.insert(createTeamWorkspaceInsert({
      id: teamId, name: unique("Lock Team"), createdBy: fixture.mike.identity.id, now,
    }));
    await repositories.workspaceMemberships.insert(createDirectMembership({
      workspaceId: teamId, userId: fixture.mike.identity.id, role: "OWNER", now,
    }));
  });
  return teamId;
}

async function createPublishedTree(teamId: string): Promise<string> {
  const root = `repos/${unique("lock")}`;
  const folder = await fixture.createFolder(fixture.mike, root, "lock");
  await fixture.createSyncedOriginal(fixture.mike, {
    parentId: folder.treeNodeId,
    sourcePath: `${root}/a.md`,
    title: "Lock A",
    markdown: "lock",
  });
  const published = await new PublicationService(fixture.uow).publish(fixture.mike, {
    teamWorkspaceId: teamId,
    name: unique("Lock Publication"),
    origin: { kind: "FOLDER", folderNodeId: folder.treeNodeId },
  });
  return published.publicationId;
}

async function sourceStatus(publicationId: string): Promise<string> {
  const rows = await fixture.pool.query<{ status: string }[]>(
    `SELECT s.status FROM publications p
     JOIN knowledge_sources s ON s.id = p.source_id
     WHERE p.id = ?`,
    [publicationId],
  );
  return String(rows[0]?.status);
}

async function lifecycleOf(teamId: string): Promise<string> {
  const rows = await fixture.pool.query<{ state: string }[]>(
    "SELECT lifecycle_state AS state FROM workspaces WHERE id = ?", [teamId]);
  return String(rows[0]?.state);
}

describe("publication writes take the Workspace shared lock", () => {
  it("blocks an archive while a publication write holds the shared lock", async () => {
    const teamId = await createTeam();
    await createPublishedTree(teamId);

    const writing = holdOpen(async (repositories) => {
      await repositories.workspaces.lockSharedById(teamId);
    });
    await writing.ready;
    try {
      await expect(new TeamWorkspaceService(waiterUow())
        .archiveTeamWorkspace(fixture.mike, teamId))
        .rejects.toMatchObject({ code: "WORKSPACE_BUSY" });
      expect(await lifecycleOf(teamId)).toBe("ACTIVE");
    } finally {
      writing.release();
      await writing.done;
    }

    await new TeamWorkspaceService(waiterUow()).archiveTeamWorkspace(fixture.mike, teamId);
    expect(await lifecycleOf(teamId)).toBe("ARCHIVED");
  }, 30_000);

  it("makes a publication write wait for governance's exclusive lock", async () => {
    const teamId = await createTeam();
    const publicationId = await createPublishedTree(teamId);

    const archiving = holdOpen(async (repositories) => {
      await repositories.workspaces.lockById(teamId);
    });
    await archiving.ready;
    try {
      await expect(new PublicationService(waiterUow()).unpublish(fixture.mike, publicationId))
        .rejects.toMatchObject({ code: "WORKSPACE_BUSY" });
      expect(await sourceStatus(publicationId)).toBe("ACTIVE");
    } finally {
      archiving.release();
      await archiving.done;
    }

    await new PublicationService(waiterUow()).unpublish(fixture.mike, publicationId);
    expect(await sourceStatus(publicationId)).toBe("ARCHIVED");
  }, 30_000);
});
