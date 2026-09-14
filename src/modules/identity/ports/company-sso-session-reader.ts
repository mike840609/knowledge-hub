/**
 * Server-side Company SSO session as read by trusted infrastructure (spec
 * §7.4). The reader validates the login session itself; the provider maps
 * these fields to trusted claims. Nothing here is browser-supplied.
 */
export type CompanySsoSession = {
  subject: string;
  emp_id: string;
  name: string;
  org_code: string;
  externalGroupIds: readonly string[];
};

export interface CompanySsoSessionReader {
  readSession(): Promise<CompanySsoSession>;
}
