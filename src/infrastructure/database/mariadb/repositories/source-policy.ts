import type { SourcePolicy, SourceType, SourceOwnership } from "@/modules/knowledge/domain/source-policy";
import type { SourcePolicyPort } from "@/modules/knowledge/ports/source-policy";
import type { SourceRepository } from "@/modules/sources/ports/source-repository";

export class MariaDbSourcePolicyRepository implements SourcePolicyPort {
  constructor(private readonly sources: SourceRepository) {}

  private map(source: Awaited<ReturnType<SourceRepository["findById"]>>): SourcePolicy | null {
    if (!source) return null;
    return {
      id: source.id, workspaceId: source.workspaceId, sourceType: source.sourceType as SourceType,
      ownership: source.ownership as SourceOwnership, status: source.status, syncVersion: source.syncVersion,
    };
  }

  async findById(sourceId: string): Promise<SourcePolicy | null> { return this.map(await this.sources.findById(sourceId)); }
  async lockById(sourceId: string): Promise<SourcePolicy | null> { return this.map(await this.sources.lockById(sourceId)); }
}
