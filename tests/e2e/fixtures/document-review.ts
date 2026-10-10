import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { phase3Origin } from "./phase3-identities";

export async function createReviewDocument(request: APIRequestContext, markdown = "A 😀 **bold** passage to review.") {
  const origin = phase3Origin("reviewOwner");
  const navigation = await (await request.get(`${origin}/api/workspaces`)).json();
  const workspaceId = navigation.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  const response = await request.post(`${origin}/api/workspaces/${workspaceId}/documents`, { data: { title: `Review ${Date.now()}`, markdown } });
  expect(response.ok()).toBe(true);
  const doc = await response.json();
  const links = [];
  for (const label of ["A", "B"]) {
    const result = await request.post(`${origin}/api/documents/${doc.documentId}/share-links`, { data: { label } });
    expect(result.ok()).toBe(true); links.push((await result.json()).link);
  }
  return { ...doc, workspaceId, links, markdown, href: `${origin}/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}` };
}

export async function selectPassage(page: Page, text = "😀 bold") {
  await page.locator("[data-review-document]").evaluate((root, selected) => {
    const paragraph = root.querySelector("p")!;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const all = paragraph.textContent!; const start = all.indexOf(selected); const end = start + selected.length;
    let offset = 0; const range = document.createRange();
    for (const node of nodes) { if (start >= offset && start < offset + node.length) range.setStart(node, start - offset); if (end > offset && end <= offset + node.length) range.setEnd(node, end - offset); offset += node.length; }
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  }, text);
}
