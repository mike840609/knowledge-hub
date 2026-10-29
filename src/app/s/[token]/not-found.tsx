import { StatusMessage } from "@/components/ui/status-message";

/** One state for every unusable link, document or folder, and every document a folder link does not reach (share-link spec §6.3, folder share spec §4): it never says which. No link into the Hub. */
export default function SharedDocumentNotFound() {
  return (
    <main>
      <StatusMessage
        title="This link is not available"
        description="It may have expired or been revoked, or it never existed. If you need it, ask the person who shared the link."
      />
    </main>
  );
}
