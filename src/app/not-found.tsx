import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { StatusMessage } from "@/components/ui/status-message";

export default function RootNotFound() {
  return (
    <main>
      <StatusMessage
        title="Page not found"
        description="This address does not match anything in the Hub."
        action={
          <Link href="/" className={buttonClasses({ variant: "secondary", size: "lg" })}>
            Go to my workspace
          </Link>
        }
      />
    </main>
  );
}
