import type { SourcePolicy, SourceType, SourceOwnership } from "@/modules/knowledge/domain/source-policy";
import type { SourcePolicyPort } from "@/modules/knowledge/ports/source-policy";
import type { SourceRepository } from "@/modules/sources/ports/source-repository";
import type { PublicationRepository } from "@/modules/sources/ports/publication-repository";

export class MariaDbSourcePolicyRepository implements SourcePolicyPort {
  constructor(
    private readonly sources: SourceRepository,
    private readonly publications: PublicationRepository,
  ) {}

  private map(source: Awaited<ReturnType<SourceRepository["findById"]>>): SourcePolicy | null {
    if (!source) return null;
    return {
      id: source.id, workspaceId: source.workspaceId, name: source.name, sourceType: source.sourceType as SourceType,
      ownership: source.ownership as SourceOwnership, status: source.status, syncVersion: source.syncVersion,
    };
  }

  private mapAll(sources: Awaited<ReturnType<SourceRepository["findByWorkspaceId"]>>): SourcePolicy[] {
    return sources.flatMap((source) => {
      const mapped = this.map(source);
      return mapped ? [mapped] : [];
    });
  }

  async findById(sourceId: string): Promise<SourcePolicy | null> { return this.map(await this.sources.findById(sourceId)); }
  async lockById(sourceId: string): Promise<SourcePolicy | null> { return this.map(await this.sources.lockById(sourceId)); }
  async listByWorkspaceId(workspaceId: string, options: { includeArchived?: boolean } = {}): Promise<SourcePolicy[]> {
    return this.mapAll(await this.sources.findByWorkspaceId(workspaceId, options));
  }
  async findPublicationDocument(documentId: string): Promise<{ creatorUserId: string; publicationId: string; sourcePath: string | null } | null> {
    return this.publications.findDocument(documentId);
  }
}
