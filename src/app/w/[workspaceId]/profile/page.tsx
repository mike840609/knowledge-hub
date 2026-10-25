import { notFound } from "next/navigation";
import { personalProfileRequest } from "@/server/personal-profile";
import { PersonalProfileView } from "@/components/personal/personal-profile-view";
import { identityProviderKind } from "@/server/config";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { workspaceId } = await params;
  const { days } = await searchParams;
  const profile = await personalProfileRequest((s, c) => s.personalProfile.get(c, workspaceId, days));
  if (!profile) notFound();

  // Loaded only for the Google demo: `sign-out-form` imports `@/auth`, which
  // instantiates Auth.js at module scope, and local/company-sso must never do
  // that just by rendering a profile page.
  const GoogleSignOut =
    identityProviderKind() === "google"
      ? (await import("@/components/auth/sign-out-form")).SignOutForm
      : null;

  return (
    <>
      <PersonalProfileView profile={profile} />
      {GoogleSignOut ? (
        <div className="kh-page pb-6">
          <GoogleSignOut />
        </div>
      ) : null}
    </>
  );
}
