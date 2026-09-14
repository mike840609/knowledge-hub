/**
 * Company SSO identity as asserted by a trusted provider. The external
 * `(provider, subject)` pair is the durable account identity truth;
 * `emp_id` is a trusted enterprise attribute, never the account-link key.
 * `subject` is opaque: persistence and lookup use exact UTF-8 bytes with no
 * trim / lowercase / Unicode normalization.
 */
export type ExternalCompanyIdentity = {
  provider: string;
  subject: string;
  emp_id: string;
  name: string;
  org_code: string;
};

export type TrustedIdentityClaims = {
  externalIdentity: ExternalCompanyIdentity;
  validatedExternalGroupIds: string[];
  platformCapabilities: string[];
  refreshedAt: Date;
};

/**
 * Durable `(provider, subject) -> hub_user_id` link row persisted in
 * `external_identity_links`.
 */
export type ExternalIdentityLink = {
  id: string;
  provider: string;
  subject: string;
  hubUserId: string;
  createdAt: Date;
  lastSeenAt: Date;
};
