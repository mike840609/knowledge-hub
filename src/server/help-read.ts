import { cache } from "react";
import { applicationServices } from "./composition";

/**
 * Where a guide's own links lead: the reader's My Space. The guides are the same for everyone at
 * one address (`/help`), so nothing in that address names a Workspace; who reads decides this.
 */
export const helpWorkspaceId = cache(async (): Promise<string> => {
  const { personalWorkspace } = await applicationServices().establishTrustedCaller();
  return personalWorkspace.id;
});
