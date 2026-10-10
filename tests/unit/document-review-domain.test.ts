import { describe, expect, it } from "vitest";
import { validateReviewBody, validateReviewIdempotencyKey, projectReviewerThread } from "@/modules/knowledge/domain/document-review";
describe("review validation", () => {
  it("counts Unicode codepoints and rejects blank bodies", () => {
    expect(validateReviewBody("😀".repeat(3000))).toHaveLength(6000);
    expect(() => validateReviewBody("😀".repeat(3001))).toThrow();
    expect(() => validateReviewBody("  ")).toThrow();
  });
  it("requires UUIDv4 keys", () => { expect(() => validateReviewIdempotencyKey("not-key")).toThrow(); });
  it("does not project hidden threads", () => { expect(projectReviewerThread({ visibility: "HIDDEN" } as never, [], { match: "OUTDATED" })).toBeNull(); });
});
import { projectReviewComment, projectOwnerThread, type ReviewThread, type ReviewComment } from "@/modules/knowledge/domain/document-review";
const hidden={visibility:"VISIBLE" as const,hiddenBy:null,hiddenAt:null,hiddenReason:null};
const thread:ReviewThread={id:"t",documentId:"d",createdRevisionId:"r",createdBy:"u",creationIdempotencyKey:"k",creationRequestHash:"hash",originShareLinkId:null,anchor:{schemaVersion:1,blockPath:[0],blockKind:"paragraph",startUtf16:0,endUtf16:6,exact:"SECRET",prefix:"old context",suffix:"old suffix"},status:"OPEN",resolvedBy:null,resolvedAt:null,createdAt:new Date(),updatedAt:new Date(),...hidden};
const comment:ReviewComment={id:"c",threadId:"t",authorUserId:"u",body:"SECRET body",createdAt:new Date(),idempotencyKey:"k",requestHash:"hash",...hidden};
it("never exposes hidden body/reason in reviewer projection",()=>{
 const hiddenComment={...comment,visibility:"HIDDEN" as const,hiddenReason:"SECRET reason",hiddenBy:"owner",hiddenAt:new Date()};
 const result=projectReviewerThread(thread,[hiddenComment],{match:"OUTDATED",anchor:thread.anchor});
 expect(JSON.stringify(result)).not.toContain("SECRET");expect(JSON.stringify(result)).not.toContain("old context");expect(result?.comments[0].body).toBe("Comment hidden by document owner");
 expect(projectReviewComment(hiddenComment)).not.toHaveProperty("hiddenReason");
 expect(projectOwnerThread(thread,[hiddenComment],{match:"OUTDATED"}).comments[0].body).toBe("SECRET body");
});
it("preserves raw text for safe React text rendering and bounds keys",()=>{
 expect(validateReviewBody("<script>raw text</script>")).toBe("<script>raw text</script>");
 expect(()=>validateReviewIdempotencyKey("a".repeat(10000))).toThrow();
 expect(validateReviewIdempotencyKey("C022F315-3187-42B7-BB07-393C9E618622")).toBe("c022f315-3187-42b7-bb07-393c9e618622");
});
it("allowlists every anchor field even for persisted JSON with extra metadata",()=>{
 const tainted={...thread.anchor,token:"secret-token",unexpected:"secret-metadata"};
 const result=projectReviewerThread({...thread,anchor:tainted},[],{match:"MATCHED",anchor:tainted});
 expect(result?.currentAnchor.anchor).toEqual(thread.anchor);
 expect(JSON.stringify(result)).not.toContain("secret-token");
 expect(projectOwnerThread({...thread,anchor:tainted},[],{match:"OUTDATED"}).originalAnchor).toEqual(thread.anchor);
});

describe("who a projection names",()=>{
 const identified:ReviewThread={...thread,documentId:"DOCUMENT-ID",createdBy:"CREATOR-ID",hiddenBy:"MODERATOR-ID",resolvedBy:"RESOLVER-ID",originShareLinkId:"LINK-ID",createdRevisionId:"REVISION-ID"};
 const authored:ReviewComment={...comment,authorUserId:"AUTHOR-ID",hiddenBy:"MODERATOR-ID"};
 const current={match:"MATCHED" as const,anchor:thread.anchor};
 it("gives a link holder no user, document, revision or link identifier",()=>{
  const view=projectReviewerThread(identified,[authored],current)!;
  expect(Object.keys(view).sort()).toEqual(["comments","createdAt","currentAnchor","id","status","updatedAt"]);
  expect(Object.keys(view.comments[0]).sort()).toEqual(["body","createdAt","id","threadId","visibility"]);
  expect(JSON.stringify(view)).not.toMatch(/-ID"/);
 });
 it("gives the same to a reply's author through the link",()=>{
  expect(JSON.stringify(projectReviewComment(authored))).not.toMatch(/-ID"/);
 });
 it("still tells the owner who wrote and moderated what",()=>{
  const view=projectOwnerThread(identified,[authored],current);
  expect(view).toMatchObject({documentId:"DOCUMENT-ID",createdBy:"CREATOR-ID",hiddenBy:"MODERATOR-ID",resolvedBy:"RESOLVER-ID"});
  expect(view.comments[0]).toMatchObject({authorUserId:"AUTHOR-ID",hiddenBy:"MODERATOR-ID"});
  expect(JSON.stringify(view)).not.toMatch(/LINK-ID|REVISION-ID/);
 });
});
