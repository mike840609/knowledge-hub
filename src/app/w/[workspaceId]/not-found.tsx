import { StatusMessage } from "@/components/ui/status-message";

export default function WorkspaceNotFound() {
  return (
    <StatusMessage
      title="Not found or no access"
      description="This content does not exist or you do not have access to it."
    />
  );
}
