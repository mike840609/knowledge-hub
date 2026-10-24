import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { resolveGoogleIdentity } from "@/server/google-identity";

/**
 * Node-only Auth.js configuration. The `jwt` callback resolves the Google
 * account to a Hub user on the first sign-in and stores only the Hub identity
 * fields on the signed token; later requests do not need the database for the
 * session itself.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
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
  },
});
