import { describe, expect, it } from "vitest";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import {
  formatGuideBytes,
  guideContent,
  type GuideBlock,
  type GuideContent,
  type GuideLimits,
} from "@/components/imports/import-guide-content";

const SECTION_IDS = [
  "what-you-need",
  "from-obsidian",
  "from-a-tool",
  "import-preview-apply",
  "keep-in-sync",
  "read-search-agent",
  "limits",
];
const LOCALES = ["en", "zh-TW"] as const;
const MiB = 1024 * 1024;

// Deliberately unlike the defaults, so a hard-coded number cannot pass.
const CUSTOM: GuideLimits = {
  maxManifestEntries: 12_345,
  maxPathBytes: 1536,
  maxMarkdownFileBytes: 2 * MiB,
  maxMarkdownTotalBytes: 96 * MiB,
};

function blockText(block: GuideBlock): string {
  switch (block.kind) {
    case "p":
    case "code":
      return block.text;
    case "ul":
    case "ol":
      return block.items.join("\n");
    case "table":
      return [...block.head, ...block.rows.flat()].join("\n");
  }
}

function allText(content: GuideContent): string {
  return [content.title, content.intro, ...content.sections.flatMap((s) => [s.title, ...s.body.map(blockText)])].join("\n");
}

function sectionText(content: GuideContent, id: string): string {
  const section = content.sections.find((s) => s.id === id);
  if (!section) throw new Error(`missing section ${id}`);
  return [section.title, ...section.body.map(blockText)].join("\n");
}

describe("guideContent structure", () => {
  it("returns the same seven section ids in the same order for both locales", () => {
    for (const locale of LOCALES) {
      expect(guideContent(locale, DEFAULT_IMPORT_LIMITS).sections.map((s) => s.id)).toEqual(SECTION_IDS);
    }
  });

  it("gives every section at least one block, and every title and intro some text", () => {
    for (const locale of LOCALES) {
      const content = guideContent(locale, DEFAULT_IMPORT_LIMITS);
      expect(content.title.length).toBeGreaterThan(0);
      expect(content.intro.length).toBeGreaterThan(0);
      for (const section of content.sections) {
        expect(section.title.length, `${locale}/${section.id} title`).toBeGreaterThan(0);
        expect(section.body.length, `${locale}/${section.id} blocks`).toBeGreaterThan(0);
      }
    }
  });

  it("has the same block kinds per section in both locales", () => {
    const kinds = (locale: "en" | "zh-TW") =>
      guideContent(locale, DEFAULT_IMPORT_LIMITS).sections.map((s) => s.body.map((b) => b.kind));
    expect(kinds("zh-TW")).toEqual(kinds("en"));
  });

  it("writes every zh-TW section title in Chinese", () => {
    const content = guideContent("zh-TW", DEFAULT_IMPORT_LIMITS);
    expect(content.title).toMatch(/\p{Script=Han}/u);
    for (const section of content.sections) {
      expect(section.title, section.id).toMatch(/\p{Script=Han}/u);
    }
  });

  it("keeps the English guide in English", () => {
    const content = guideContent("en", DEFAULT_IMPORT_LIMITS);
    expect(allText(content)).not.toMatch(/\p{Script=Han}/u);
  });
});

describe("guideContent limits are live", () => {
  it("shows the limits it was given, not remembered defaults", () => {
    for (const locale of LOCALES) {
      const limits = sectionText(guideContent(locale, CUSTOM), "limits");
      expect(limits, locale).toContain("12,345");
      expect(limits, locale).toContain("1.5 KiB");
      expect(limits, locale).toContain("2 MiB");
      expect(limits, locale).toContain("96 MiB");
      for (const stale of ["20,000", "2 KiB", "5 MiB", "256 MiB"]) {
        expect(limits, `${locale} still says ${stale}`).not.toContain(stale);
      }
    }
  });

  it("types no default number anywhere in the prose when given other limits", () => {
    for (const locale of LOCALES) {
      const all = allText(guideContent(locale, CUSTOM));
      for (const stale of ["20,000", "5 MiB", "256 MiB"]) {
        expect(all, `${locale} still says ${stale}`).not.toContain(stale);
      }
    }
  });

  it("shows the default limits when given the defaults", () => {
    const limits = sectionText(guideContent("en", DEFAULT_IMPORT_LIMITS), "limits");
    for (const text of ["20,000", "2 KiB", "5 MiB", "256 MiB"]) expect(limits).toContain(text);
  });

  it("names the per-file limit in the checklist, from the same number", () => {
    for (const locale of LOCALES) {
      expect(sectionText(guideContent(locale, CUSTOM), "from-a-tool"), locale).toContain("2 MiB");
    }
  });

  it("states the exclusion and attachment facts next to the limits", () => {
    const en = sectionText(guideContent("en", DEFAULT_IMPORT_LIMITS), "limits");
    expect(en).toContain("50");
    expect(en).toMatch(/wildcard/i);
    expect(en).toMatch(/no binary attachment storage/i);
    const zh = sectionText(guideContent("zh-TW", DEFAULT_IMPORT_LIMITS), "limits");
    expect(zh).toContain("50");
    expect(zh).toContain("萬用字元");
  });
});

describe("formatGuideBytes", () => {
  it.each([
    [512, "512 B"],
    [2048, "2 KiB"],
    [1536, "1.5 KiB"],
    [5 * MiB, "5 MiB"],
    [256 * MiB, "256 MiB"],
    [1024 * MiB, "1 GiB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatGuideBytes(bytes)).toBe(expected);
  });
});

describe("guideContent facts", () => {
  const en = (id: string) => sectionText(guideContent("en", DEFAULT_IMPORT_LIMITS), id);
  const zh = (id: string) => sectionText(guideContent("zh-TW", DEFAULT_IMPORT_LIMITS), id);

  it("from-a-tool: skipped folders and title precedence", () => {
    const text = en("from-a-tool");
    expect(text).toContain(".git");
    expect(text).toContain(".obsidian");
    expect(text).toMatch(/frontmatter[\s\S]*first H1[\s\S]*file name/i);
  });

  it("from-a-tool: says dot-prefixed names are skipped without a warning, in both locales", () => {
    expect(en("from-a-tool")).toMatch(/names start with a dot[\s\S]*skipped without a warning/);
    expect(en("from-a-tool")).toContain("node_modules");
    expect(zh("from-a-tool")).toMatch(/名稱以點開頭[\s\S]*會被略過，而且不會出現警告/);
    expect(zh("from-a-tool")).toContain("node_modules");
  });

  it("keep-in-sync: says a rename plus edit starts a new document, and how knowledge_id prevents it", () => {
    expect(en("keep-in-sync")).toMatch(/rename or move a file and also edit it before the next sync, it becomes a new document/);
    expect(en("keep-in-sync")).toMatch(/share links, favorites and history stay with the archived copy/);
    expect(en("keep-in-sync")).toMatch(/`knowledge_id`.*up to 512 characters, unique within the folder/);
    expect(en("keep-in-sync")).toMatch(/removing or changing it, or reusing it in another file, blocks the next Preview/);
    expect(zh("keep-in-sync")).toMatch(/同時改名（或移動）並編輯.*會變成一份新文件/);
    expect(zh("keep-in-sync")).toContain("`knowledge_id`");
    expect(zh("keep-in-sync")).toMatch(/移除或修改它，或在另一個檔案重複使用，都會讓下一次預覽無法套用/);
  });

  it("from-a-tool: skipped paths are never uploaded and do not count toward the limits", () => {
    expect(en("from-a-tool")).toMatch(/never read or uploaded, and they do not count toward the file-count or size limits/);
    expect(en("from-a-tool")).not.toMatch(/still listed in the upload/);
    expect(zh("from-a-tool")).toMatch(/不會被讀取或上傳，也不計入檔案數與大小限制/);
    expect(zh("from-a-tool")).not.toMatch(/仍會列在上傳清單中/);
  });

  it("limits table: the always-skipped row matches the checklist", () => {
    const row = (locale: "en" | "zh-TW") => {
      const table = guideContent(locale, DEFAULT_IMPORT_LIMITS).sections.find((x) => x.id === "limits")!.body.find((b) => b.kind === "table");
      if (table?.kind !== "table") throw new Error("no table");
      return table.rows.find((r) => /Always skipped|一律略過/.test(r[0]))![1];
    };
    for (const locale of LOCALES) {
      for (const name of [".git", ".obsidian", "node_modules", "Thumbs.db"]) expect(row(locale), `${locale} ${name}`).toContain(name);
    }
    expect(row("en")).toMatch(/start with a dot/);
    expect(row("zh-TW")).toContain("以點開頭");
  });

  it("from-a-tool: the file-location item does not ban ../ in links", () => {
    expect(en("from-a-tool")).toContain("links between files may still use `../`");
    expect(zh("from-a-tool")).toContain("`../`");
  });

  it("says the Preview upload is temporary and that Copy for Agent is for the personal workspace", () => {
    expect(en("import-preview-apply")).toMatch(/sends the Markdown files[\s\S]*temporary Preview/);
    expect(en("read-search-agent")).toMatch(/personal workspace/);
    expect(zh("read-search-agent")).toContain("個人工作區");
    expect(zh("import-preview-apply")).toContain("上傳");
  });

  it("from-a-tool: a six-item checklist", () => {
    for (const locale of LOCALES) {
      const section = guideContent(locale, DEFAULT_IMPORT_LIMITS).sections.find((s) => s.id === "from-a-tool")!;
      const lists = section.body.filter((b): b is Extract<GuideBlock, { kind: "ul" | "ol" }> => b.kind === "ul" || b.kind === "ol");
      expect(lists.some((l) => l.items.length === 6), locale).toBe(true);
    }
  });

  it("states the link forms, anchors and the Preview warning", () => {
    const text = [en("from-a-tool"), en("import-preview-apply"), en("what-you-need")].join("\n");
    expect(text).toContain("[[Title]]");
    expect(text).toContain("[[folder/Note]]");
    expect(text).toMatch(/relative[^\n]*\.md/i);
    expect(text).toMatch(/GitHub/);
    expect(text).toMatch(/exactly one warning/i);
  });

  it("keeps the sync model: one-way, read-only, removed files archived, Chrome or Edge", () => {
    const text = en("keep-in-sync");
    expect(text).toMatch(/one-way/i);
    expect(text).toMatch(/read-only/i);
    expect(text).toMatch(/archived/i);
    expect(text).toMatch(/Chrome or Edge/);
    expect(zh("keep-in-sync")).toMatch(/Chrome 或 Edge/);
    expect(zh("keep-in-sync")).toMatch(/封存/);
    expect(zh("keep-in-sync")).toMatch(/唯讀/);
  });

  it("says Copy for Agent takes 1 to 20 documents", () => {
    expect(en("read-search-agent")).toMatch(/1.{1,3}20 documents/);
    expect(zh("read-search-agent")).toMatch(/1.{1,3}20/);
  });

  it("uses the reviewed zh-TW terms", () => {
    const text = guideContent("zh-TW", DEFAULT_IMPORT_LIMITS);
    const all = allText(text);
    expect(all).toContain("維基連結（wikilink）");
    expect(all).toContain("筆記庫（vault）");
    expect(all).not.toContain("資料庫");
    expect(all).not.toContain("（wikilink）`[[wikilinks]]`");
    expect(all).toContain("預覽（Preview）");
    expect(all).toContain("套用（Apply）");
  });

  it("names no third-party wiki tool", () => {
    for (const locale of LOCALES) {
      const all = allText(guideContent(locale, DEFAULT_IMPORT_LIMITS)).toLowerCase();
      expect(all, locale).not.toContain("openwiki");
      expect(all, locale).not.toContain("obsidian-wiki");
    }
  });

  it("says images are stored only when the server stores them", () => {
    for (const locale of LOCALES) {
      const off = allText(guideContent(locale, DEFAULT_IMPORT_LIMITS));
      const on = allText(guideContent(locale, DEFAULT_IMPORT_LIMITS, true));
      expect(off, locale).not.toContain("![alt](path)");
      expect(on, locale).toContain("![alt](path)");
      expect(on, locale).toContain("![[image.png]]");
      expect(on, locale).not.toMatch(/no binary attachment storage|不儲存二進位附件/);
    }
  });
});
