import type { SourcePolicy } from "../domain/source-policy";

export interface SourcePolicyPort {
  findById(sourceId: string): Promise<SourcePolicy | null>;
  lockById(sourceId: string): Promise<SourcePolicy | null>;
}
