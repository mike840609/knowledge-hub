/**
 * Company SSO identity as asserted by a trusted provider. The external
 * `(provider, subject)` pair is the durable account identity truth;
 * `emp_id` is a trusted enterprise attribute, never the account-link key.
 * `subject` is opaque: persistence and lookup use exact UTF-8 bytes with no
 * trim / lowercase / Unicode normalization. `account` is the human-readable
 * company account name, stored as profile data (never a link key) and `null`
 * for providers without a company account. `name_en` is the optional English
 * display name, also stored as profile data.
 */
export type ExternalCompanyIdentity = {
  provider: string;
  subject: string;
  emp_id: string;
  account: string | null;
  name_en: string | null;
  name: string;
  org_code: string;
};

export type { TrustedIdentityClaims } from "./trusted-identity-claims";

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
