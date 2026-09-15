import type { ExternalIdentityLink } from "../domain/external-company-identity";

export interface ExternalIdentityLinkRepository {
  findByProviderSubject(provider: string, subject: string): Promise<ExternalIdentityLink | null>;
  findByProviderHubUser(provider: string, hubUserId: string): Promise<ExternalIdentityLink | null>;
  insert(link: ExternalIdentityLink): Promise<void>;
  touchLastSeen(id: string, lastSeenAt: Date): Promise<void>;
}
