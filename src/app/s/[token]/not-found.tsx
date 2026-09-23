import { StatusMessage } from "@/components/ui/status-message";

/** One state for every unusable link (share-link spec §6.3). No link into the Hub. */
export default function SharedDocumentNotFound() {
  return (
    <main>
      <StatusMessage
        title="This link is not available"
        description="It may have expired or been revoked, or it never existed. If you need this document, ask the person who shared it."
      />
    </main>
  );
}
