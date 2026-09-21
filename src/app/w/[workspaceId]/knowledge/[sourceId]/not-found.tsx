import { StatusMessage } from "@/components/ui/status-message";

export default function SourceDocumentNotFound() {
  return (
    <main className="flex min-h-full flex-col justify-center">
      <StatusMessage
        title="Not found or no access"
        description="This content does not exist or you do not have access to it."
      />
    </main>
  );
}
