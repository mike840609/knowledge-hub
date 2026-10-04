import type { FolderImportClientLimits } from "@/components/imports/folder-import-form";
import Link from "next/link";
import type { SourceListItemModel } from "@/server/source-read";
import { SourceListRow } from "@/components/sources/source-list-row";
import { navigateListRows } from "@/lib/list-row-navigation";
export function HomeFolderList({
  workspaceId,
  items,
  limits,
}: {
  workspaceId: string;
  items: SourceListItemModel[];
  limits?: FolderImportClientLimits;
}) {
  const folders = items.filter((i) => i.source.sourceType === "FOLDER_SYNC");
  return <div> {folders.length ? (
    <ul onKeyDown={navigateListRows} className="space-y-0.5">
      {folders.map((item) => (
        <SourceListRow
          key={item.source.id}
          workspaceId={workspaceId}
          limits={limits}
          item={item}
        />
      ))}
    </ul>
  ) : (
    <p className="px-3 py-2 text-body text-kh-text-muted">
      Import a Markdown folder to bring your knowledge into My Space.{" "}
      <Link className="text-kh-link" href={`/w/${workspaceId}/sources/import`}>
        Import folder
      </Link>
    </p>
  )}<p className="px-3 pt-3 text-caption text-kh-text-muted">Your local folder is the source of truth. Edit locally, check for changes, review the Preview, then select Apply. Updates are checked manually.</p></div>;
}
