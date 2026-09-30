import { phase3PersonaNames } from "./phase3-identities";

/**
 * A second ordinary server on the same build and the same database, started with Team workspaces
 * closed. Every other server the E2E harness starts has them open (scripts/test/e2e.ts), because the
 * specs about Team workspaces and about the switcher need them; what a reader sees while they are
 * closed can only be looked at on a server that is.
 */
export function teamsClosedOrigin(): string {
  return `http://127.0.0.1:${Number(process.env.KM_E2E_PORT ?? "3101") + 2 + phase3PersonaNames.length}`;
}
