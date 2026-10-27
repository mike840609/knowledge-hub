import type { NextAuthConfig } from "next-auth";
import { resolveGoogleIdentity } from "@/server/google-identity";

type AuthCallbacks = NonNullable<NextAuthConfig["callbacks"]>;

/**
 * Auth.js callbacks live outside `auth.ts` so they can be unit-tested without
 * evaluating `NextAuth()`. The `jwt` callback is the only place Google claims
 * become Hub identity fields, and it runs when `account` is present — i.e. on
 * the first sign-in. Later requests reuse the signed token.
 */
export const authCallbacks = {
  async jwt({ token, account, profile }) {
    if (account?.provider === "google" && typeof profile?.sub === "string") {
      const identity = await resolveGoogleIdentity({
        subject: profile.sub,
        name: typeof profile.name === "string" ? profile.name : "",
        email: typeof profile.email === "string" ? profile.email : "",
      });
      token.hubUserId = identity.id;
      token.empId = identity.emp_id;
      token.orgCode = identity.org_code;
      token.displayName = identity.name;
    }
    return token;
  },
  session({ session, token }) {
    if (session.user) {
      session.user.hubUserId = String(token.hubUserId ?? "");
      session.user.empId = String(token.empId ?? "");
      session.user.orgCode = String(token.orgCode ?? "");
      session.user.displayName = String(token.displayName ?? "");
    }
    return session;
  },
} satisfies AuthCallbacks;
