import { afterEach, describe, expect, it, vi } from "vitest";
import { teamWorkspacesEnabled } from "@/server/config";

afterEach(() => vi.unstubAllEnvs());

/**
 * Team workspaces are announced and not yet open. The flag that opens them is read on every request
 * and is strict: only the word `true` opens them, so that a value nobody meant (`1`, `yes`, `TRUE`, a
 * trailing space) cannot open something that is meant to be closed.
 */
describe("teamWorkspacesEnabled", () => {
  it("is closed when nothing says otherwise", () => {
    vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", undefined as unknown as string);
    expect(teamWorkspacesEnabled()).toBe(false);
  });

  it("is open for the word true, and only for it", () => {
    vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", "true");
    expect(teamWorkspacesEnabled()).toBe(true);
    for (const value of ["", "false", "1", "yes", "TRUE", "True", " true", "true ", "open", "enabled"]) {
      vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", value);
      expect(teamWorkspacesEnabled(), JSON.stringify(value)).toBe(false);
    }
  });

  it("is read when asked, so opening them is a restart and not a build", () => {
    vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", "false");
    expect(teamWorkspacesEnabled()).toBe(false);
    vi.stubEnv("KM_TEAM_WORKSPACES_ENABLED", "true");
    expect(teamWorkspacesEnabled()).toBe(true);
  });
});
