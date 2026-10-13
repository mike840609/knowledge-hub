import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "@/components/knowledge/markdown-renderer";

const fence = (info: string, code: string) => "```" + info + "\n" + code + "\n```";
const html = (markdown: string) => renderToStaticMarkup(<MarkdownRenderer markdown={markdown} />);
const DIAGRAM = "flowchart LR\n  A[One <b>] --> B";

describe("a mermaid block, as the server sends it", () => {
  const page = html(fence("mermaid", DIAGRAM));

  it("is wrapped for drawing", () => {
    expect(page).toContain("<figure data-mermaid");
  });

  it("is still the code block it was: the code as text, where a comment finds it, with its copy button", () => {
    expect(page).toContain("data-code-block");
    expect(page).toMatch(/<code[^>]*data-review-path="0"[^>]*>flowchart LR\n {2}A\[One &lt;b&gt;\] --&gt; B\n<\/code>/);
    expect(page).toContain('aria-label="Copy code"');
  });

  it("reads as that code block before any script runs: the disclosure is open and its summary is not shown", () => {
    expect(page).toMatch(/<details[^>]*\sopen=""/);
    expect(page).toMatch(/<summary[^>]*class="[^"]*\bhidden\b/);
  });

  it("holds no picture, no reason and no markup of the author's", () => {
    expect(page).not.toContain("<img");
    expect(page).not.toContain("data-diagram-reason");
    // The copy button's icon is an <svg>; a drawing would be one outside it.
    expect(page.replace(/<button[\s\S]*?<\/button>/g, "")).not.toContain("<svg");
    expect(page).not.toContain("<b>");
  });

  it("is wrapped wherever a code block can be", () => {
    for (const markdown of [`- item\n\n  ${fence("mermaid", "pie").replaceAll("\n", "\n  ")}`, `> ${fence("mermaid", "pie").replaceAll("\n", "\n> ")}`, `<details>\n<summary>More</summary>\n\n${fence("mermaid", "pie")}\n\n</details>`]) {
      expect(html(markdown), markdown).toContain("<figure data-mermaid");
    }
  });

  it("is told from its fence's first word alone", () => {
    expect(html(fence("mermaid title=flow", "pie"))).toContain("<figure data-mermaid");
  });
});

describe("what is not a mermaid block", () => {
  it.each([["Mermaid"], ["MERMAID"], ["mmd"], ["mermaidjs"], ["js"], [""]])("a fence that says %j", (info) => {
    const page = html(fence(info, "flowchart LR\n  A --> B"));
    expect(page).not.toContain("data-mermaid");
    expect(page).toContain("data-code-block");
  });

  it("an indented block whose text is a diagram", () => {
    expect(html("Text.\n\n    flowchart LR\n      A --> B")).not.toContain("data-mermaid");
  });
});
