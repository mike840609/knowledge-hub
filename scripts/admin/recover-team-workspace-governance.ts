import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { TEAM_GOVERNANCE_RECOVERED_EVENT } from "@/modules/workspaces/application/team-workspace-service";
import { assertPersonalMutationAllowed } from "@/modules/workspaces/application/personal-workspace-service";
import { WorkspaceLifecycleError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

/**
 * Phase 3 system-only Team governance recovery (spec §14.3).
 *
 * Operator CLI for stranded Teams: restore an ARCHIVED Team or grant an
 * existing Hub user a direct OWNER membership. Every action is audited with
 * GOVERNANCE_RECOVERED in the same transaction. Never exposed via HTTP/UI —
 * this module has no route, handler, or browser entry point.
 */

export type RecoveryBaseOptions = {
  workspaceId: string;
  reason: string;
};

export type GrantOwnerOptions = RecoveryBaseOptions & {
  userId: string;
};

export type RecoveryResult = {
  workspaceId: string;
  restored: boolean;
};

export type GrantOwnerResult = {
  workspaceId: string;
  userId: string;
  alreadyOwner: boolean;
};

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new WorkspaceLifecycleError("Governance recovery requires a non-empty operator reason for the audit trail.");
  }
  return trimmed;
}

export async function restoreTeamWorkspaceGovernance(pool: Pool, options: RecoveryBaseOptions): Promise<RecoveryResult> {
  const reason = requireReason(options.reason);
  const now = new Date();
  const restored = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    const locked = await repositories.workspaces.lockById(options.workspaceId);
    if (!locked) throw new WorkspaceNotFoundError();
    assertPersonalMutationAllowed(locked, "restore");
    if (locked.workspaceType !== "TEAM") {
      throw new WorkspaceLifecycleError("Governance recovery restore applies to TEAM workspaces only.");
    }
    const wasArchived = locked.lifecycleState === "ARCHIVED";
    if (wasArchived) {
      await repositories.workspaces.setWorkspaceLifecycle(options.workspaceId, "ACTIVE", null, null, now);
    }
    await repositories.auditEvents.append({
      id: uuidv7(),
      workspaceId: options.workspaceId,
      actorUserId: null,
      actorKind: "SYSTEM",
      eventType: TEAM_GOVERNANCE_RECOVERED_EVENT,
      targetType: "WORKSPACE",
      targetId: options.workspaceId,
      payload: { action: "restore", restored: wasArchived, reason },
      correlationId: null,
      createdAt: now,
    });
    return wasArchived;
  });
  return { workspaceId: options.workspaceId, restored };
}

export async function grantTeamWorkspaceOwner(pool: Pool, options: GrantOwnerOptions): Promise<GrantOwnerResult> {
  const reason = requireReason(options.reason);
  const now = new Date();
  const alreadyOwner = await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    const locked = await repositories.workspaces.lockById(options.workspaceId);
    if (!locked) throw new WorkspaceNotFoundError();
    assertPersonalMutationAllowed(locked, "add-member");
    if (locked.workspaceType !== "TEAM") {
      throw new WorkspaceLifecycleError("Governance recovery grant applies to TEAM workspaces only.");
    }
    const user = await repositories.users.findById(options.userId);
    if (!user) {
      throw new WorkspaceLifecycleError("Governance recovery can only grant an existing Hub user direct OWNER.");
    }
    const existing = await repositories.workspaceMemberships.find(options.workspaceId, options.userId);
    if (existing && existing.membershipSource !== "DIRECT" && existing.membershipSource !== null) {
      throw new WorkspaceLifecycleError("Governance recovery cannot rewrite a system-provisioned membership.");
    }
    let isOwner = existing?.role === "OWNER" && (existing.membershipSource === "DIRECT" || existing.membershipSource === null);
    if (!existing) {
      await repositories.workspaceMemberships.insert(
        createDirectMembership({ workspaceId: options.workspaceId, userId: options.userId, role: "OWNER", createdBy: options.userId, now }),
      );
      isOwner = false;
    } else if (!isOwner) {
      await repositories.workspaceMemberships.updateRole(options.workspaceId, options.userId, "OWNER", now);
      isOwner = false;
    }
    await repositories.auditEvents.append({
      id: uuidv7(),
      workspaceId: options.workspaceId,
      actorUserId: null,
      actorKind: "SYSTEM",
      eventType: TEAM_GOVERNANCE_RECOVERED_EVENT,
      targetType: "USER",
      targetId: options.userId,
      payload: { action: "grant-owner", reason, alreadyOwner: existing?.role === "OWNER" },
      correlationId: null,
      createdAt: now,
    });
    return existing?.role === "OWNER";
  });
  return { workspaceId: options.workspaceId, userId: options.userId, alreadyOwner };
}

const RECOVERY_HELP = `Usage:
  npx tsx scripts/admin/recover-team-workspace-governance.ts --workspace-id <id> --restore --reason <text> [--target dev|test|e2e]
  npx tsx scripts/admin/recover-team-workspace-governance.ts --workspace-id <id> --grant-owner <hub-user-id> --reason <text> [--target dev|test|e2e]

Phase 3 system-only Team governance recovery (spec §14.3). Operator CLI only:
never expose via HTTP/UI. Every action appends a GOVERNANCE_RECOVERED audit
event in the same transaction. Restoring an ACTIVE workspace is a no-op that
still audits; granting a user who is already direct OWNER is a no-op that
still audits.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(RECOVERY_HELP);
    return;
  }
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const workspaceId = valueOf("--workspace-id");
  const reason = valueOf("--reason");
  const target = valueOf("--target") ?? "dev";
  const restore = args.includes("--restore");
  const grantOwner = valueOf("--grant-owner");
  if (!workspaceId || !reason || (!restore && !grantOwner) || (restore && grantOwner)) {
    throw new Error("Invalid arguments. Expected --workspace-id plus exactly one of --restore / --grant-owner, and --reason.");
  }
  if (target !== "dev" && target !== "test" && target !== "e2e") {
    throw new Error("Invalid arguments. Expected: [--target dev|test|e2e].");
  }
  const pool = createDatabasePool(databaseConfig(target));
  try {
    if (restore) {
      const result = await restoreTeamWorkspaceGovernance(pool, { workspaceId, reason });
      console.log(`Governance recovery complete: workspace ${result.workspaceId} ${result.restored ? "restored to ACTIVE" : "already ACTIVE (audited)"}.`);
    } else if (grantOwner) {
      const result = await grantTeamWorkspaceOwner(pool, { workspaceId, userId: grantOwner, reason });
      console.log(
        `Governance recovery complete: user ${result.userId} ${result.alreadyOwner ? "already direct OWNER (audited)" : "granted direct OWNER"} on workspace ${result.workspaceId}.`,
      );
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
