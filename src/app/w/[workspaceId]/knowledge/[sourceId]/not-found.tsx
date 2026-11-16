import { WorkspaceNotFound } from "@/components/shell/workspace-not-found";

export default function SourceDocumentNotFound() {
  return (
    <main className="flex min-h-full flex-col justify-center">
      <WorkspaceNotFound />
    </main>
  );
}
