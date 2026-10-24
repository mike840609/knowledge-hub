import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-safe Auth.js configuration. Middleware imports this file; it must not
 * import MariaDB or any Node-only module. The database-backed callbacks live
 * in `auth.ts`, which only Node route handlers and server components import.
 */
export const authConfig = {
  providers: [Google],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
} satisfies NextAuthConfig;
