import { Suspense } from "react";
import { OpenInHubHint } from "@/components/knowledge/open-in-hub-hint";
import { StatusMessage } from "@/components/ui/status-message";

/**
 * One state for every unusable link, document or folder, and every document a folder link does not reach (share-link spec §6.3, folder share spec §4): it never says which.
 * A named share answers here too, since this page has no caller; its one way in is the neutral line into the Hub, shown for every token alike (named-recipient share spec).
 */
export default function SharedDocumentNotFound() {
  return (
    <main>
      <StatusMessage
        title="This link is not available"
        description="It may have expired or been revoked, or it never existed. If you need it, ask the person who shared the link."
        action={<Suspense fallback={null}><OpenInHubHint /></Suspense>}
      />
    </main>
  );
}
