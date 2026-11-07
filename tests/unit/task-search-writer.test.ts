import { describe, expect, it } from "vitest";
import { IngestTaskResultService } from "@/modules/task-knowledge/application/ingest-task-result";
import type { TaskKnowledgeRepositories, TaskKnowledgeUnitOfWork } from "@/modules/task-knowledge/ports/unit-of-work";

const bindingId = "019a1e18-7a00-7000-8000-0a0000000001";
const workspaceId = "019a1e18-7a00-7000-8000-0a0000000002";
const taskResultId = "019a1e18-7a00-7000-8000-0a0000000003";
const userId = "019a1e18-7a00-7000-8000-0a0000000004";
const artifact = {
  schemaVersion: 1, taskId: "d744a789-0561-409b-8dbb-a65a94828c39",
  artifactRevision: 1, agent: "opencode", status: "completed",
  title: "Token issue", summary: "Fixed the problem.",
  completedAt: "2026-11-06T09:00:00.123456789+08:00",
  verification: { status: "passed" },
};

function fakeWriter() {
  const events: string[] = [];
  const projections: unknown[] = [];
  const binding = { id: bindingId, ownerUserId: userId, workspaceId, label: "laptop", status: "ACTIVE", createdAt: new Date(), revokedAt: null };
  const taskExports = {
    findCredentialByHash: async () => ({ id: bindingId, bindingId, status: "ACTIVE" }),
    getBinding: async () => binding,
    lockBindingShared: async () => binding,
    insertTaskIfAbsent: async () => taskResultId,
    lockTaskForUpdate: async () => ({ id: taskResultId, lifecycle: "ACTIVE", latestRevisionNo: 0 }),
    getRevision: async () => null,
    insertRevision: async () => { events.push("revision"); },
    insertReferences: async () => { events.push("references"); },
    advanceLatestRevision: async () => { events.push("latest"); },
    upsertSearchProjection: async (projection: unknown) => { events.push("projection"); projections.push(projection); },
  };
  const r = {
    taskExports,
    workspaces: { lockSharedById: async () => ({ workspaceId, kind: "PERSONAL", status: "ACTIVE", ownerUserId: userId }) },
  } as unknown as TaskKnowledgeRepositories;
  const unitOfWork: TaskKnowledgeUnitOfWork = {
    run: async <T>(work: (repositories: TaskKnowledgeRepositories) => Promise<T>) => work(r),
  };
  return { service: new IngestTaskResultService(unitOfWork), events, projections };
}

describe("atomic task search writer", () => {
  it("updates latest projection inside the same ingest unit of work", async () => {
    const writer = fakeWriter();
    const result = await writer.service.ingest("secret", new TextEncoder().encode(JSON.stringify(artifact)));
    expect(result).toMatchObject({ state: "CREATED", taskResultId });
    expect(writer.events).toEqual(["revision", "references", "latest", "projection"]);
    expect(writer.projections[0]).toMatchObject({
      taskResultId, revisionNo: 1, completedAtEpochMs: Date.parse("2026-11-06T01:00:00.123Z"),
      title: "Token issue", summary: "Fixed the problem.", verificationStatus: "passed",
    });
  });
});

