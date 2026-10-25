import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { safeReturnTo } from "@/lib/auth-paths";
import { identityProviderKind } from "@/server/config";
import { buttonClasses } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[]; error?: string | string[] }>;
}) {
  if (identityProviderKind() !== "google") redirect("/");

  const { returnTo, error } = await searchParams;
  const target = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);

  // A failed callback still reaches this page. When the failure was a retry of
  // an already-consumed code, the first attempt has signed the visitor in, so
  // an existing session must win over the error message.
  if (await auth()) redirect(target);

  const failure = typeof error === "string" && error.length > 0;

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
        {failure ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-kh-danger-border bg-kh-danger-bg px-3 py-2 text-body text-kh-danger"
          >
            Sign-in didn&apos;t complete. Please try again.
          </p>
        ) : null}
        <form action={continueWithGoogle} className="mt-5">
          <button type="submit" className={buttonClasses({ className: "w-full" })}>
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
