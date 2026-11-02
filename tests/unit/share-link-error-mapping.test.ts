import { describe, expect, it } from "vitest";
import {
  InvalidShareLinkExpiryError,
  InvalidShareLinkLabelError,
  ShareLinkLimitReachedError,
  ShareLinkNotFoundError,
  ShareLinkNotPersonalError,
} from "@/modules/knowledge/domain/document-share-link";
import { toWorkspaceErrorResponse } from "@/server/http-error-response";
import { DomainError } from "@/shared/domain/errors";

describe("share-link error mapping (share-link spec §9.4)", () => {
  it("hides an unusable link as a generic 404", () => {
    const mapped = toWorkspaceErrorResponse(new ShareLinkNotFoundError());
    expect(mapped.status).toBe(404);
    expect(mapped.body.error.code).toBe("NOT_FOUND");
  });

  it("maps a Team document and the link limit to 409", () => {
    expect(toWorkspaceErrorResponse(new ShareLinkNotPersonalError()).status).toBe(409);
    expect(toWorkspaceErrorResponse(new ShareLinkLimitReachedError()).status).toBe(409);
  });

  it("maps invalid expiry and label to 400 with their codes", () => {
    expect(toWorkspaceErrorResponse(new InvalidShareLinkExpiryError())).toMatchObject({ status: 400, body: { error: { code: "INVALID_SHARE_LINK_EXPIRY" } } });
    expect(toWorkspaceErrorResponse(new InvalidShareLinkLabelError())).toMatchObject({ status: 400, body: { error: { code: "INVALID_SHARE_LINK_LABEL" } } });
  });

  it("maps a mention of someone a NAMED link does not name to 400 with its code", () => {
    expect(toWorkspaceErrorResponse(new DomainError("MENTION_NOT_RECIPIENT", "Mention only people this document is shared with.")))
      .toMatchObject({ status: 400, body: { error: { code: "MENTION_NOT_RECIPIENT" } } });
  });
});
