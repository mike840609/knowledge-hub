import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { SourceUnitOfWork } from "../ports/unit-of-work";
import { buildLinkResolver } from "@/modules/knowledge/domain/link-resolution";
import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuidv7";
export type SourceHealthPage = {
  sourceName: string;
  workspaceId: string;
  sourceId: string;
  indexIncomplete: boolean;
  legacyWarnings: number;
  diagnostics: {
    id: string;
    documentId: string | null;
    title: string;
    sourcePath: string | null;
    code: string;
    message: string;
    href: string | null;
  }[];
  nextCursor: string | null;
};
const numberKey = (n: number) => String(n).padStart(8, "0");
export class GetSourceHealthService {
  constructor(private readonly uow: SourceUnitOfWork) {}
  async get(
    caller: CallerContext,
    workspaceId: string,
    sourceId: string,
    afterId = "",
  ): Promise<SourceHealthPage> {
    return this.uow.run(async (r) => {
      await r.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
      const source = await r.sources.findById(sourceId);
      if (
        !source ||
        source.workspaceId !== workspaceId ||
        source.status !== "ACTIVE"
      )
        throw new DomainError("SOURCE_NOT_FOUND", "Source unavailable.");
      const parts = afterId.split(":"),
        warningPhase = parts[0] === "warning";
      if (
        afterId &&
        (parts.length !== 3 ||
          (!warningPhase && parts[0] !== "link") ||
          (!warningPhase && !isUuid(parts[1])) ||
          !/^\d+$/.test(parts[2]) ||
          (warningPhase && !/^\d+$/.test(parts[1])))
      )
        throw new DomainError("INVALID_REQUEST", "Invalid health cursor.");
      const [catalog, index, runs] = await Promise.all([
        r.links.loadCatalog(workspaceId),
        r.links.countIndexState(workspaceId),
        r.syncRuns.listBySourceId(sourceId, 1, "APPLIED"),
      ]);
      const diagnostics: SourceHealthPage["diagnostics"] = [];
      const base = {
        sourceName: source.name,
        workspaceId,
        sourceId,
        indexIncomplete: index.stale > 0,
        legacyWarnings: 0,
      };
      if (!warningPhase) {
        const edges = await r.links.loadHealthEdges(
          workspaceId,
          sourceId,
          afterId ? { documentId: parts[1], ordinal: Number(parts[2]) } : null,
          1001,
        );
        const resolver = buildLinkResolver(catalog),
          byId = new Map(catalog.map((d) => [d.documentId, d]));
        for (const edge of edges.slice(0, 1000)) {
          const doc = byId.get(edge.documentId);
          if (!doc) continue;
          const link = edge.link,
            resolution = resolver.resolve(link, doc);
          const code =
            resolution.status === "UNRESOLVED"
              ? "UNRESOLVED_LINK"
              : resolution.ambiguousWith > 0
                ? "AMBIGUOUS_LINK"
                : null;
          if (code)
            diagnostics.push({
              id: `link:${doc.documentId}:${numberKey(link.ordinal)}`,
              documentId: doc.documentId,
              title: doc.title,
              sourcePath: doc.sourcePath,
              code,
              message: `${code === "UNRESOLVED_LINK" ? "Cannot resolve" : "Multiple articles match"} “${link.target}” (line ${link.line}).`,
              href: `/w/${workspaceId}/knowledge/${sourceId}/${doc.documentId}`,
            });
          if (diagnostics.length > 50)
            return {
              ...base,
              diagnostics: diagnostics.slice(0, 50),
              nextCursor: diagnostics[49].id,
            };
        }
        if (edges.length > 1000) {
          const last = edges[999];
          return {
            ...base,
            diagnostics,
            nextCursor: `link:${last.documentId}:${numberKey(last.link.ordinal)}`,
          };
        }
      }
      const latest = runs[0];
      if (!latest) return { ...base, diagnostics, nextCursor: null };
      const recorded =
        (await r.syncRunChanges.listByRun(latest.id, 0, 1)).length > 0;
      const legacyWarnings = recorded
        ? 0
        : Number(latest.summary.warnings ?? 0) || 0;
      const rows = await r.syncRunChanges.listDiagnosticChanges(
        latest.id,
        warningPhase ? Number(parts[1]) : 0,
        51,
      );
      for (const c of rows.slice(0, 50))
        for (let i = 0; i < c.diagnostics.length; i++) {
          if (
            warningPhase &&
            c.ordinal === Number(parts[1]) &&
            i <= Number(parts[2])
          )
            continue;
          const d = c.diagnostics[i];
          if (d.severity !== "WARNING") continue;
          diagnostics.push({
            id: `warning:${numberKey(c.ordinal)}:${numberKey(i)}`,
            documentId: c.documentId,
            title: c.title,
            sourcePath: c.sourcePath,
            code: d.code,
            message: d.message,
            href: c.documentId
              ? `/w/${workspaceId}/sources/${sourceId}/runs/${latest.id}`
              : null,
          });
          if (diagnostics.length > 50)
            return {
              ...base,
              legacyWarnings,
              diagnostics: diagnostics.slice(0, 50),
              nextCursor: diagnostics[49].id,
            };
        }
      return {
        ...base,
        legacyWarnings,
        diagnostics,
        nextCursor:
          rows.length > 50
            ? `warning:${numberKey(rows[49].ordinal)}:99999999`
            : null,
      };
    });
  }
}
