import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe Auth.js configuration. Middleware imports this file; it must not
 * import MariaDB or any Node-only module. The database-backed callbacks live
 * in `auth.ts`, which only Node route handlers and server components import.
 */
export const authConfig = {
  providers: [Google],
  // Auth.js renders its own error page (HTTP 500) for a failed OAuth callback.
  // A browser retry of a single-use authorization code is one way to get there,
  // and by then the first callback may already have created the session. Send
  // those failures to /login: it shows a retry message when signed out, and
  // forwards into the app when a session already exists. A misconfigured
  // Auth.js still fails its own assertion with a JSON 500 before this runs.
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
} satisfies NextAuthConfig;
