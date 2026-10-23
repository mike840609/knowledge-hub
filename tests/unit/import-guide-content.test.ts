import { describe, expect, it } from "vitest";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import {
  formatGuideBytes,
  guideContent,
  type GuideBlock,
  type GuideContent,
  type GuideLimits,
} from "@/components/imports/import-guide-content";

const SECTION_IDS = ["example", "checklist", "titles-links", "knowledge-id", "limits"];
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
    case "note":
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
  it("returns the same five section ids in the same order for both locales", () => {
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
      expect(sectionText(guideContent(locale, CUSTOM), "checklist"), locale).toContain("2 MiB");
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

  it("is a format reference titled to match the link that leads to it", () => {
    expect(guideContent("en", DEFAULT_IMPORT_LIMITS).title).toBe("Folder format and import rules");
    expect(guideContent("zh-TW", DEFAULT_IMPORT_LIMITS).title).toBe("資料夾格式與匯入規則");
  });

  it("example: a folder tree to choose, a file with every form, and an Obsidian vault fits as it is", () => {
    for (const text of [en("example"), zh("example")]) {
      expect(text).toContain(".obsidian");
      expect(text).toMatch(/---\ntitle: .+\nknowledge_id: leave-policy\n---/);
      expect(text).toContain("[[");
      expect(text).toContain("](../index.md)");
      expect(text).toContain("## ");
    }
    expect(en("example")).toMatch(/Obsidian vault already fits/);
    expect(zh("example")).toContain("筆記庫（vault）");
  });

  it("checklist: a six-item list naming the per-file limit, skipped names and ../ links", () => {
    for (const locale of LOCALES) {
      const section = guideContent(locale, DEFAULT_IMPORT_LIMITS).sections.find((s) => s.id === "checklist")!;
      const lists = section.body.filter((b): b is Extract<GuideBlock, { kind: "ul" | "ol" }> => b.kind === "ul" || b.kind === "ol");
      expect(lists.some((l) => l.items.length === 6), locale).toBe(true);
    }
    expect(en("checklist")).toMatch(/names start with a dot[\s\S]*skipped without a warning/);
    expect(en("checklist")).toMatch(/never read or uploaded, and they do not count toward the file-count or size limits/);
    expect(en("checklist")).toContain("links between files may still use `../`");
    expect(zh("checklist")).toMatch(/名稱以點開頭[\s\S]*會被略過，而且不會出現警告/);
    expect(zh("checklist")).toMatch(/不會被讀取或上傳，也不計入檔案數與大小限制/);
    for (const text of [en("checklist"), zh("checklist")]) expect(text).toContain("node_modules");
  });

  it("titles-links: title precedence, the three link forms, GitHub anchors, one workspace", () => {
    const text = en("titles-links");
    expect(text).toMatch(/frontmatter[\s\S]*first H1[\s\S]*file name/i);
    expect(text).toContain("[[Title]]");
    expect(text).toContain("[[folder/Note]]");
    expect(text).toMatch(/relative[^\n]*\.md/i);
    expect(text).toMatch(/GitHub/);
    expect(text).toMatch(/one workspace/);
    expect(zh("titles-links")).toContain("維基連結（wikilink）");
    expect(zh("titles-links")).toContain("同一個工作區");
  });

  it("knowledge-id: leads with what a rename plus edit loses, then the steps", () => {
    for (const locale of LOCALES) {
      const body = guideContent(locale, DEFAULT_IMPORT_LIMITS).sections.find((s) => s.id === "knowledge-id")!.body;
      expect(body[0].kind, locale).toBe("note");
      expect(body.some((b) => b.kind === "ol" && b.items.length === 3), locale).toBe(true);
    }
    expect(en("knowledge-id")).toMatch(/rename or move a file and also edit it before the next sync, it becomes a new document/);
    expect(en("knowledge-id")).toMatch(/share links, favorites and history stay with the archived copy/);
    expect(en("knowledge-id")).toMatch(/`knowledge_id`.*up to 512 characters, unique within the folder/);
    expect(en("knowledge-id")).toMatch(/removing or changing it, or reusing it in another file, blocks the next Preview/);
    expect(zh("knowledge-id")).toMatch(/同時改名（或移動）並編輯.*會變成一份新文件/);
    expect(zh("knowledge-id")).toMatch(/移除或修改它，或在另一個檔案重複使用，都會讓下一次預覽無法套用/);
  });

  it("limits table: the always-skipped row names every skipped path", () => {
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

  it("leaves operating to the user guide: no Preview, sync or Copy for Agent walkthrough here", () => {
    for (const locale of LOCALES) {
      const all = allText(guideContent(locale, DEFAULT_IMPORT_LIMITS));
      expect(all, locale).not.toContain("Copy for Agent");
      expect(all, locale).not.toMatch(/Check for changes|Update from folder/);
    }
  });

  it("uses the reviewed zh-TW terms", () => {
    const all = allText(guideContent("zh-TW", DEFAULT_IMPORT_LIMITS));
    expect(all).toContain("維基連結（wikilink）");
    expect(all).toContain("筆記庫（vault）");
    expect(all).not.toContain("資料庫");
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
});
