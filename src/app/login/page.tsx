import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { safeReturnTo } from "@/lib/auth-paths";
import { identityProviderKind } from "@/server/config";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  if (identityProviderKind() !== "google") redirect("/");
  if (await auth()) redirect("/");

  const { returnTo } = await searchParams;
  const target = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);

  async function continueWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: target });
  }

  return (
    <main className="kh-page flex min-h-screen items-center justify-center">
      <section className="w-full max-w-md rounded-lg border border-kh-border bg-kh-bg p-6">
        <h1 className="text-title font-semibold text-kh-text">Sign in to Knowledge Hub</h1>
        <p className="mt-2 text-body text-kh-text-muted">
          Use your Google account to open your My Space.
        </p>
        <form action={continueWithGoogle} className="mt-5">
          <button type="submit" className={buttonClasses({ className: "w-full" })}>
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
