import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LOCAL_IDENTITY_PROVIDER_NAME } from "@/infrastructure/identity/local-identity-provider";
import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import { callerFromIdentity, callerFromPrincipal, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import type { KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import { establishTrustedCaller, type TrustedCallerDependencies } from "@/server/trusted-caller";

const identity: UserIdentity = { id: "0199f400-0000-7000-8000-0000000006a1", emp_id: "SYNC-1", name: "Reader", org_code: "HRSD" };
const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000006a2";

function bootstrap(upsertIdentity: () => Promise<void>): { dependencies: TrustedCallerDependencies; order: string[] } {
  const order: string[] = [];
  const dependencies = {
    provider: {
      getCurrentClaims: async () => ({
        externalIdentity: { provider: LOCAL_IDENTITY_PROVIDER_NAME, subject: "local" },
        validatedExternalGroupIds: ["group-a"],
        platformCapabilities: [],
        refreshedAt: new Date(0),
      }),
      getCurrentIdentity: async () => identity,
    },
    resolver: { resolve: async () => identity },
    personalWorkspaces: { ensurePersonalWorkspace: async () => { order.push("my-space"); return { workspace: { id: WORKSPACE_ID }, created: false }; } },
    unitOfWork: { run: async (work: (repositories: { users: { upsertIdentity: () => Promise<void> } }) => Promise<unknown>) => {
      const result = await work({ users: { upsertIdentity } });
      order.push("committed");
      return result;
    } },
  } as unknown as TrustedCallerDependencies;
  return { dependencies, order };
}

function queryService(upsertIdentity: () => Promise<void>): KnowledgeQueryServiceImpl {
  const repositories = {
    users: { upsertIdentity },
    workspaceAccess: { requireMembership: async () => undefined },
    sourcePolicy: { listByWorkspaceId: async () => [] },
  };
  return new KnowledgeQueryServiceImpl({ run: async (work) => work(repositories as never) } as KnowledgeUnitOfWork);
}

describe("syncing the caller's identity", () => {
  it("upserts a caller nobody has synced", async () => {
    const upsertIdentity = vi.fn(async () => undefined);
    const caller = callerFromIdentity(identity);
    await syncCallerIdentity({ upsertIdentity }, caller);
    expect(upsertIdentity).toHaveBeenCalledTimes(1);
    expect(upsertIdentity).toHaveBeenCalledWith(caller.identity);
  });

  it("does not repeat it for a caller the request bootstrap already synced", async () => {
    const upsertIdentity = vi.fn(async () => undefined);
    await syncCallerIdentity({ upsertIdentity }, { ...callerFromIdentity(identity), identitySynced: true });
    expect(upsertIdentity).not.toHaveBeenCalled();
  });

  it("lets a failed upsert fail the caller's request", async () => {
    const upsertIdentity = vi.fn(async () => { throw new Error("identity conflict"); });
    await expect(syncCallerIdentity({ upsertIdentity }, callerFromIdentity(identity))).rejects.toThrow("identity conflict");
  });
});

describe("who may mark a caller as synced", () => {
  it("is not the caller constructors: built from an identity or a principal, a caller is unsynced", () => {
    expect(callerFromIdentity(identity).identitySynced).toBeUndefined();
    const principal = { identity, validatedExternalGroupIds: [], platformCapabilities: [], refreshedAt: new Date(0), identitySynced: true };
    expect((callerFromPrincipal(principal) as CallerContext).identitySynced).toBeUndefined();
  });

  it("is the request bootstrap, once its upsert has committed", async () => {
    const upsertIdentity = vi.fn(async () => undefined);
    const { dependencies, order } = bootstrap(upsertIdentity);
    const { caller } = await establishTrustedCaller(dependencies);
    expect(upsertIdentity).toHaveBeenCalledTimes(1);
    expect(upsertIdentity).toHaveBeenCalledWith(identity);
    expect(order).toEqual(["committed", "my-space"]);
    expect(caller.identitySynced).toBe(true);
    expect(caller.identity).toEqual(identity);
    expect(caller.validatedExternalGroupIds).toEqual(["group-a"]);
  });

  it("yields no caller at all when the bootstrap's upsert fails", async () => {
    const { dependencies } = bootstrap(async () => { throw new Error("identity conflict"); });
    await expect(establishTrustedCaller(dependencies)).rejects.toThrow("identity conflict");
  });
});

describe("a service asked by a synced caller", () => {
  it("reads without upserting the identity again", async () => {
    const upsertIdentity = vi.fn(async () => undefined);
    await queryService(upsertIdentity).listSources({ ...callerFromIdentity(identity), identitySynced: true }, WORKSPACE_ID);
    expect(upsertIdentity).not.toHaveBeenCalled();
  });

  it("still upserts for a caller that did not come through the bootstrap", async () => {
    const upsertIdentity = vi.fn(async () => undefined);
    await queryService(upsertIdentity).listSources(callerFromIdentity(identity), WORKSPACE_ID);
    expect(upsertIdentity).toHaveBeenCalledTimes(1);
  });
});

/**
 * The skip only holds if every service goes through `syncCallerIdentity`. A
 * service calling the repository directly would still be correct, and would
 * quietly bring the repeated work back.
 */
describe("identity upsert call sites", () => {
  function filesUnder(root: string): string[] {
    return readdirSync(root).flatMap((name) => {
      const full = path.join(root, name);
      if (statSync(full).isDirectory()) return filesUnder(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("are the helper and the request bootstrap, and nothing else", () => {
    const direct = [...filesUnder("src/modules"), ...filesUnder("src/server"), ...filesUnder("src/app")]
      .filter((file) => /\.upsertIdentity\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.split(path.sep).join("/"));
    expect(direct.sort()).toEqual([
      "src/modules/identity/application/sync-caller-identity.ts",
      "src/server/trusted-caller.ts",
    ]);
  });
});
