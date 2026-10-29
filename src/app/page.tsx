import { redirect } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { isSharedReturn } from "@/lib/auth-paths";

export const dynamic = "force-dynamic";
export default async function HomePage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const { returnTo } = await searchParams;
  // Only a shared page (to comment, signed in) or its opening route may continue a login; each
  // rechecks link validity, and the opening route document access.
  if (typeof returnTo === "string" && isSharedReturn(returnTo)) redirect(returnTo);
  const navigation = await services.workspaceAdmin.navigation(caller);
  const personal = navigation.items.find((item) => item.type === "PERSONAL");
  if (!personal) throw new Error("Personal workspace provisioning is unavailable.");
  redirect(`/w/${personal.id}/${caller.personalWorkspaceOnly ? "home" : "knowledge"}`);
}
