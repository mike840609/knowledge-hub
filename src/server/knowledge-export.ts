import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeQueryService } from "@/modules/knowledge/application/knowledge-query-service";
import { exportMarkdown, exportName, exportZip } from "@/lib/markdown-export";
import { DomainError } from "@/shared/domain/errors";
export async function workspaceExport(queries: KnowledgeQueryService, caller: CallerContext, workspaceId: string) {
  const sources = await queries.listSources(caller, workspaceId, { includeArchived: true });
  const files: { path: string; content: string }[] = [];
  const manifest: { documentId: string; sourceId: string; path: string; status: string; revisionNo: number }[] = [];
  let bytes = 0;
  for (const source of sources) {
    const tree = await queries.listTree(caller, source.id, { includeArchived: true });
    for (const node of tree) {
      if (node.type !== "document") continue;
      const revision = await queries.getCurrentRevision(caller, node.documentId, { includeArchived: true });
      const folders: string[] = []; let parent = node.parentId; const visited = new Set<string>();
      while (parent && !visited.has(parent)) { visited.add(parent); const folder = tree.find(n => n.id === parent); if (!folder) break; folders.unshift(exportName(folder.label, folder.id)); parent = folder.parentId; }
      const path = [exportName(source.name, source.id), ...folders, `${exportName(revision.title, node.documentId)}.md`].join("/");
      const content = exportMarkdown(revision); bytes += Buffer.byteLength(content);
      if (bytes > 64 * 1024 * 1024 || files.length >= 9999) throw new DomainError("VALIDATION_ERROR", "Workspace export exceeds 64 MiB or 9,999 documents. Download individual documents instead.");
      files.push({ path, content }); manifest.push({ documentId: node.documentId, sourceId: source.id, path, status: node.status, revisionNo: revision.revisionNo });
    }
  }
  files.push({ path: "manifest.json", content: JSON.stringify({ format: 1, documents: manifest, note: "Current saved revisions, including archived documents. Drafts, revision history and attachment binaries are not included. Original Markdown links are preserved." }, null, 2) });
  return exportZip(files);
}
