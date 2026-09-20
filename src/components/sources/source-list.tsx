import type { SourceListItemModel } from "@/server/source-read";
import { SourceListRow } from "@/components/sources/source-list-row";

export function SourceList({ workspaceId, items }: { workspaceId: string; items: SourceListItemModel[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-md bg-kh-bg-subtle p-6 text-body text-kh-text-muted">
        No knowledge sources yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <SourceListRow key={item.source.id} workspaceId={workspaceId} item={item} />
      ))}
    </ul>
  );
}
