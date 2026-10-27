import { signOut } from "@/auth";
import { buttonClasses } from "@/components/ui/button";

export function SignOutForm() {
  async function action() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <form action={action}>
      <button type="submit" className={buttonClasses({ variant: "secondary" })}>
        Sign out
      </button>
    </form>
  );
}
