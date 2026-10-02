import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { e2eTeamWorkspacesEnabled, requiredE2eServices } from "../../scripts/test/e2e-services";

const source = (name: string) => readFileSync(new URL(`../e2e/${name}`, import.meta.url), "utf8");

describe("E2E service requirements", () => {
  test("default E2E mode enables Team fixtures despite personal development defaults", () => {
    expect(e2eTeamWorkspacesEnabled({ KM_TEAM_WORKSPACES_ENABLED: "false" })).toBe("true");
  });
  test("personal-only E2E mode closes Teams regardless of development configuration", () => {
    expect(e2eTeamWorkspacesEnabled({ KM_TEAM_WORKSPACES_ENABLED: "true", KM_E2E_PERSONAL_ONLY: "true" })).toBe("false");
  });
  test("personal workspace needs only the local application", () => {
    expect(requiredE2eServices([source("personal-workspace.spec.ts")])).toEqual({ personas: false, unconfigured: false, teamsClosed: false });
  });
  test("anonymous share readers need the fail-closed server, not the SSO fixture build", () => {
    expect(requiredE2eServices([source("share-link.spec.ts")])).toEqual({ personas: false, unconfigured: true, teamsClosed: false });
  });
  test("Team availability needs the closed-Team server", () => {
    expect(requiredE2eServices([source("team-workspaces-coming-soon.spec.ts")])).toEqual({ personas: false, unconfigured: false, teamsClosed: true });
  });
  test("combines governance, anonymous-reader and availability coverage", () => {
    expect(requiredE2eServices([source("phase3-workspace-governance.spec.ts"), source("share-link.spec.ts"), source("team-workspaces-coming-soon.spec.ts")])).toEqual({ personas: true, unconfigured: true, teamsClosed: true });
  });
});
