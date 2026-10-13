import { redirect } from "next/navigation";
import { applicationServices } from "@/server/composition";

export const dynamic = "force-dynamic";
export default async function HomePage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const { returnTo } = await searchParams;
  // Only the share-opening route may continue a login; it rechecks link validity and document access.
  if (typeof returnTo === "string" && /^\/s\/[A-Za-z0-9_-]{1,128}\/open$/.test(returnTo)) redirect(returnTo);
  const navigation = await services.workspaceAdmin.navigation(caller);
  const personal = navigation.items.find((item) => item.type === "PERSONAL");
  if (!personal) throw new Error("Personal workspace provisioning is unavailable.");
  redirect(`/w/${personal.id}/${caller.personalWorkspaceOnly ? "home" : "knowledge"}`);
}
