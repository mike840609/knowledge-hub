import { expect, it } from "vitest";
import { PersonalService } from "@/modules/personal/application/personal-service";
import { parseCreateDocumentInput } from "@/server/authoring-input";

const userId = "0199f500-0000-7000-8000-0000000005a2";
const workspaceId = "0199f500-0000-7000-8000-0000000005a1";
const caller = { identity: { id: userId }, validatedExternalGroupIds: [] } as never;
const uow = {
  run: async (work: (repositories: unknown) => unknown) => work({
    workspaceMemberships: { find: async () => ({ role: "OWNER" }) },
    workspaces: { findById: async () => ({ personalOwnerUserId: userId }) },
  }),
};

it("rejects the same 2M-CJK draft that publishing rejects", async () => {
  const service = new PersonalService({ put: async () => true } as never, {} as never, uow as never);
  const markdown = "中".repeat(2_000_000);
  await expect(service.put(caller, workspaceId, "draft:new", { title: "Draft", markdown, baseRevisionId: null }, 0))
    .rejects.toMatchObject({ code: "DRAFT_TOO_LARGE" });
  expect(() => parseCreateDocumentInput({ title: "Draft", markdown })).toThrow("Markdown is too large");
});
