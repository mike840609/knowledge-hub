import type { TrustedIdentityClaims, PlatformCapability } from "@/modules/identity/domain/trusted-identity-claims";
import type { IdentityProvider } from "@/modules/identity/ports/identity-provider";
import type { CompanySsoSessionReader } from "@/modules/identity/ports/company-sso-session-reader";
import { IdentityError } from "@/modules/knowledge/domain/errors";

export type CompanySsoProviderOptions = {
  provider: string;
  teamCreateGroupIds: readonly string[];
};

export class CompanySsoIdentityProvider implements IdentityProvider {
  constructor(
    private readonly sessionReader: CompanySsoSessionReader,
    private readonly options: CompanySsoProviderOptions,
  ) {
    if (!options.provider) {
      throw new IdentityError("Company SSO provider name is not configured; refusing to issue claims.");
    }
  }

  async getCurrentIdentity(): Promise<never> {
    throw new IdentityError(
      "Company SSO identities must be resolved to Hub users through HubIdentityResolver; a direct Hub identity is unavailable.",
    );
  }

  async getCurrentClaims(): Promise<TrustedIdentityClaims> {
    const session = await this.sessionReader.readSession();
    assertSessionField(session.subject, "subject");
    assertSessionField(session.emp_id, "emp_id");
    assertSessionField(session.name, "name");
    assertSessionField(session.org_code, "org_code");
    const validatedExternalGroupIds = dedupeGroups(session.externalGroupIds);
    const platformCapabilities: readonly PlatformCapability[] = this.options.teamCreateGroupIds.some((group) =>
      validatedExternalGroupIds.includes(group),
    )
      ? ["workspace.create_team"]
      : [];
    return {
      externalIdentity: {
        provider: this.options.provider,
        subject: session.subject,
        emp_id: session.emp_id,
        name: session.name,
        org_code: session.org_code,
      },
      validatedExternalGroupIds,
      platformCapabilities,
      refreshedAt: new Date(),
    };
  }
}

function assertSessionField(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new IdentityError(`Company SSO session is missing required identity field: ${field}.`);
  }
}

function dedupeGroups(groups: readonly string[]): string[] {
  const validated: string[] = [];
  for (const group of groups) {
    if (typeof group !== "string" || group.length === 0) continue;
    if (!validated.includes(group)) validated.push(group);
  }
  return validated;
}
