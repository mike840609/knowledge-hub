import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Pool } from "mariadb";
import { MariaDbUnitOfWork } from "../../../src/infrastructure/database/mariadb/transaction";
import { PersonalWorkspaceService } from "../../../src/modules/workspaces/application/personal-workspace-service";
import { createTeamWorkspaceInsert } from "../../../src/modules/workspaces/domain/workspace";
import { createDirectMembership } from "../../../src/modules/workspaces/domain/workspace-membership";
import { randomUUID } from "node:crypto";
import { PHASE3_TEAM_ID, PHASE3_PROVIDER, phase3PersonaNames, phase3Session, phase3UserId } from "./phase3-identities";

/** Generate a separate test application; the normal Next entry never imports fixture code. */
export async function preparePhase3Application(projectRoot: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "km-phase3-http-"));
  try {
    for (const name of ["src", "public", "next.config.ts", "next-env.d.ts", "tsconfig.json", "package.json", "postcss.config.mjs", "tailwind.config.ts"]) {
      await cp(path.join(projectRoot, name), path.join(root, name), { recursive: true }).catch((error: NodeJS.ErrnoException) => {
        if (name !== "public" || error.code !== "ENOENT") throw error;
      });
    }
    await symlink(path.join(projectRoot, "node_modules"), path.join(root, "node_modules"), "dir");
    // Copy the fixed catalog into the isolated application's server bundle.
    await cp(path.join(projectRoot, "tests/e2e/fixtures/phase3-identities.ts"), path.join(root, "src/server/phase3-identities.ts"));
    await writeFile(path.join(root, "src/server/phase3-fixture-reader.ts"), `
import { phase3PersonaNames, phase3Session, type Phase3Persona } from "./phase3-identities";
const persona = process.env.KM_PHASE3_SERVER_PERSONA as Phase3Persona;
if (!phase3PersonaNames.includes(persona)) throw new Error("Missing fixed Phase 3 server persona.");
const fixedSession = phase3Session(persona);
export const fixtureReader = { async readSession() { return { ...fixedSession, externalGroupIds: [...fixedSession.externalGroupIds] }; } };
`);
    const compositionPath = path.join(root, "src/server/composition.ts");
    const composition = await readFile(compositionPath, "utf8");
    const registration = "let companySessionReader: CompanySsoSessionReader | undefined;";
    if (!composition.includes(registration)) throw new Error("Composition reader registration changed; review test-only injection.");
    await writeFile(compositionPath, `import { fixtureReader } from "./phase3-fixture-reader";\n${composition.replace(registration, "let companySessionReader: CompanySsoSessionReader | undefined = fixtureReader;")}`);
    // The copied project needs only application types, never the parent's stale .next output.
    const config = JSON.parse(await readFile(path.join(root, "tsconfig.json"), "utf8"));
    config.include = ["next-env.d.ts", ".next/types/**/*.ts", "src/**/*.ts", "src/**/*.tsx"];
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify(config, null, 2));
    return root;
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}

export async function seedPhase3Identities(pool: Pool): Promise<void> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const now = new Date();
  for (const persona of phase3PersonaNames) {
    const session = phase3Session(persona);
    const id = phase3UserId(persona);
    await unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity({ id, emp_id: session.emp_id, name: session.name, org_code: session.org_code });
      await repositories.identityLinks.insert({ id: randomUUID(), provider: PHASE3_PROVIDER, subject: session.subject, hubUserId: id, createdAt: now, lastSeenAt: now });
    });
    await new PersonalWorkspaceService(unitOfWork).ensurePersonalWorkspace(id);
  }
  await unitOfWork.run(async (repositories) => {
    const ownerId = phase3UserId("owner");
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: PHASE3_TEAM_ID, name: "Phase3 shared Team", createdBy: ownerId, now }));
    for (const [persona, role] of [["owner", "OWNER"], ["admin", "ADMIN"], ["editor", "EDITOR"], ["viewer", "VIEWER"], ["mixedEditor", "EDITOR"]] as const) {
      await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: PHASE3_TEAM_ID, userId: phase3UserId(persona), role, createdBy: ownerId, now }));
    }
    for (const [externalGroupId, role] of [["phase3-admins", "ADMIN"], ["phase3-editors", "EDITOR"], ["phase3-viewers", "VIEWER"]] as const) {
      await repositories.groupMappings.insert({ id: randomUUID(), workspaceId: PHASE3_TEAM_ID, externalGroupId, role, createdBy: ownerId, createdAt: now, updatedAt: now });
    }
  });
}
