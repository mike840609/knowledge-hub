import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      hubUserId: string;
      empId: string;
      orgCode: string;
      displayName: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    hubUserId?: string;
    empId?: string;
    orgCode?: string;
    displayName?: string;
  }
}
