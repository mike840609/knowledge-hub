import { redirect } from "next/navigation";
import { applicationServices } from "@/server/composition";

export const dynamic = "force-dynamic";
export default async function HomePage() {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const navigation = await services.workspaceAdmin.navigation(caller);
  const personal = navigation.items.find((item) => item.type === "PERSONAL");
  if (!personal) throw new Error("Personal workspace provisioning is unavailable.");
  redirect(`/w/${personal.id}/knowledge`);
}
