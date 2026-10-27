import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Edge-only Auth.js instance. Middleware imports this lazily, only when the
 * Google provider is selected, so local/company-sso deployments never load
 * Auth.js or require its environment.
 */
export const googleAuth = NextAuth(authConfig).auth;
