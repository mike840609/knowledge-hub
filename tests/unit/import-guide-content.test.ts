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

  it("from-a-tool: a five-item checklist", () => {
    for (const locale of LOCALES) {
      const section = guideContent(locale, DEFAULT_IMPORT_LIMITS).sections.find((s) => s.id === "from-a-tool")!;
      const lists = section.body.filter((b): b is Extract<GuideBlock, { kind: "ul" | "ol" }> => b.kind === "ul" || b.kind === "ol");
      expect(lists.some((l) => l.items.length === 5), locale).toBe(true);
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
