import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { authCallbacks } from "./auth-callbacks";

/**
 * Node-only Auth.js configuration. The `jwt` callback resolves the Google
 * account to a Hub user on the first sign-in and stores only the Hub identity
 * fields on the signed token; later requests do not need the database for the
 * session itself. The callbacks live in `auth-callbacks.ts` so they stay
 * testable without instantiating Auth.js.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: authCallbacks,
});
