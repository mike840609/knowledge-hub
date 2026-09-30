import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_LENGTH,
  SUGGESTION_LIMIT,
  findWikiLinkTrigger,
  isWritableAsWikiLink,
  rankSuggestions,
} from "@/components/knowledge/editor/link-suggestions";
import type { LinkTargetView } from "@/modules/knowledge/application/knowledge-link-service";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import { buildLinkResolver, normalizeLinkKey, type CatalogDocument } from "@/modules/knowledge/domain/link-resolution";

let counter = 0;
function target(title: string, editedAt: string, sourceName = "Notes", sourceId = "source-1"): LinkTargetView {
  counter += 1;
  return { documentId: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`, sourceId, sourceName, title, editedAt };
}
const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T00:00:00.000Z`;
const titles = (query: string, list: LinkTargetView[], limit?: number) => rankSuggestions(list, query, limit).map((s) => s.target.title);

describe("findWikiLinkTrigger", () => {
  it("finds the link being written, and what has been typed of it", () => {
    expect(findWikiLinkTrigger("see [[Kub")).toEqual({ from: 4, query: "Kub" });
    expect(findWikiLinkTrigger("[[")).toEqual({ from: 0, query: "" });
    expect(findWikiLinkTrigger("參考 [[知識 庫")).toEqual({ from: 3, query: "知識 庫" });
  });

  it("is the last `[[`, so an earlier finished link does not hide a new one", () => {
    expect(findWikiLinkTrigger("[[done]] and [[ne")).toEqual({ from: 13, query: "ne" });
  });

  it("is not there once the link is closed, or the name is chosen", () => {
    expect(findWikiLinkTrigger("[[Kube]]")).toBeNull();
    expect(findWikiLinkTrigger("[[Kube]")).toBeNull();
    expect(findWikiLinkTrigger("[[Kube|the cluster")).toBeNull();
    expect(findWikiLinkTrigger("[[Kube#Install")).toBeNull();
    expect(findWikiLinkTrigger("[[Kube [x")).toBeNull();
    expect(findWikiLinkTrigger("[[a\nb")).toBeNull();
  });

  it("is not there when the brackets are not a link", () => {
    expect(findWikiLinkTrigger("\\[[x")).toBeNull();
    expect(findWikiLinkTrigger("![[x")).toBeNull();
    expect(findWikiLinkTrigger("[x")).toBeNull();
    expect(findWikiLinkTrigger("no brackets")).toBeNull();
  });

  it("gives up on a query too long to be a name", () => {
    expect(findWikiLinkTrigger(`[[${"a".repeat(MAX_QUERY_LENGTH)}`)).not.toBeNull();
    expect(findWikiLinkTrigger(`[[${"a".repeat(MAX_QUERY_LENGTH + 1)}`)).toBeNull();
  });
});

describe("rankSuggestions", () => {
  const list = [
    target("Kubernetes", day(1)),
    target("Kubernetes upgrade notes", day(5)),
    target("How to run Kubernetes", day(9)),
    target("Kube-proxy", day(7)),
    target("Airflow", day(8)),
  ];

  it("puts a title that is the query first, then one that starts with it, then one that contains it", () => {
    // Recency alone would say: how-to (9), upgrade notes (5), Kubernetes (1).
    expect(titles("kubernetes", list)).toEqual(["Kubernetes", "Kubernetes upgrade notes", "How to run Kubernetes"]);
  });

  it("orders each group by when it was last edited", () => {
    expect(titles("kube", list)).toEqual(["Kube-proxy", "Kubernetes upgrade notes", "Kubernetes", "How to run Kubernetes"]);
  });

  it("offers everything, newest first, for an empty query", () => {
    expect(titles("", list)).toEqual(["How to run Kubernetes", "Airflow", "Kube-proxy", "Kubernetes upgrade notes", "Kubernetes"]);
    expect(titles("   ", list)).toEqual(titles("", list));
  });

  it("offers nothing that does not fit", () => {
    expect(titles("zookeeper", list)).toEqual([]);
  });

  it("ignores case, extra spaces and how an accent was typed", () => {
    const accents = [target("Café society", day(1)), target("Naïve Bayes", day(2))];
    expect(titles("CAFÉ   SOC", accents)).toEqual(["Café society"]);
    // The same letters as a base letter and a combining mark.
    expect(titles("cafe\u0301", accents)).toEqual(["Café society"]);
    expect(titles("nai\u0308ve", accents)).toEqual(["Naïve Bayes"]);
  });

  it("finds Chinese titles by prefix and by what they contain", () => {
    const zh = [target("我的知識庫", day(3)), target("知識管理", day(1)), target("知識", day(2)), target("薪資報表", day(4))];
    expect(titles("知識", zh)).toEqual(["知識", "知識管理", "我的知識庫"]);
    expect(titles("報表", zh)).toEqual(["薪資報表"]);
  });

  it("takes a full-width query for the ordinary letters and digits, and still writes the title", () => {
    const mixed = [target("Kubernetes", day(1)), target("2026 budget", day(2))];
    expect(titles("ｋｕｂｅ", mixed)).toEqual(["Kubernetes"]);
    expect(titles("２０２６", mixed)).toEqual(["2026 budget"]);
    expect(rankSuggestions(mixed, "ｋｕｂｅ")[0].link).toBe("[[Kubernetes]]");
  });

  it("writes the title as it is, not as it was typed", () => {
    const [suggestion] = rankSuggestions([target("  Kubernetes  ", day(1))], "kube");
    expect(suggestion.link).toBe("[[Kubernetes]]");
  });

  it("offers both of two documents with one title, and says how many share it", () => {
    const twins = [target("Runbook", day(1), "Team notes", "source-a"), target("Runbook", day(2), "Personal", "source-b"), target("Other", day(3))];
    const result = rankSuggestions(twins, "run");
    expect(result.map((s) => [s.target.sourceName, s.sameTitle, s.link])).toEqual([
      ["Personal", 1, "[[Runbook]]"],
      ["Team notes", 1, "[[Runbook]]"],
    ]);
    expect(rankSuggestions(twins, "other")[0].sameTitle).toBe(0);
  });

  it("counts titles the resolver reads as one as the same, and ones it tells apart as different", () => {
    const list = [target("Plan", day(1)), target("  plan ", day(2)), target("Ｐlan", day(3))];
    // `Ｐlan` (full-width P) matches the query but is not what `[[Plan]]` resolves to.
    const result = rankSuggestions(list, "plan");
    expect(result.map((s) => [s.target.title, s.sameTitle])).toEqual([
      ["Ｐlan", 0],
      ["  plan ", 1],
      ["Plan", 1],
    ]);
  });

  it("does not offer a title that cannot be written as a link, and fills the list from the next ones", () => {
    const list = [
      target("a|b", day(9)),
      target("a#b", day(8)),
      target("a/b", day(7)),
      target("a.md", day(6)),
      target("a [b]", day(5)),
      target("a *b*", day(4)),
      target("a plain", day(3)),
    ];
    expect(titles("a", list)).toEqual(["a plain"]);
    expect(titles("", list, 1)).toEqual(["a plain"]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: 30 }, (_, index) => target(`Note ${index}`, day(index + 1)));
    expect(rankSuggestions(many, "note")).toHaveLength(SUGGESTION_LIMIT);
    expect(titles("note", many, 3)).toEqual(["Note 29", "Note 28", "Note 27"]);
  });

  it("gives the same order however the list arrived, and leaves it alone", () => {
    const same = [target("Alpha", day(1)), target("alpha", day(1)), target("ALPHA", day(1)), target("Alpha ", day(1))];
    const copy = [...same];
    const forward = rankSuggestions(same, "alpha").map((s) => s.target.documentId);
    const backward = rankSuggestions([...same].reverse(), "alpha").map((s) => s.target.documentId);
    expect(backward).toEqual(forward);
    expect(same).toEqual(copy);
  });
});

/**
 * "What is picked is what the link resolves to" (spec §6.1): every link `rankSuggestions` writes,
 * put into a document and resolved against the catalog those very documents make, goes to the
 * document that was picked — or, for a title two documents share, to one of the two, which the
 * resolver's own rule then chooses between.
 */
describe("a picked suggestion resolves to what was picked", () => {
  const messy = [
    "Kubernetes",
    "kubernetes cluster",
    "  Padded  title ",
    "Two   spaces",
    "Café",
    "Cafe\u0301 society",
    "知識庫",
    "薪資報表 2026",
    "２０２６ plan",
    "C++ notes",
    "What is a DAG?",
    "100% done",
    "Q&A",
    "under_score_name",
    "a.b.c",
    "tab\tinside",
    "ends with dot.",
    "Airflow",
  ];

  it("holds for every suggestion, for each thing that could be typed", () => {
    const list = messy.map((title, index) => target(title, day(index + 1)));
    const catalog: CatalogDocument[] = list.map((entry) => ({
      documentId: entry.documentId,
      sourceId: entry.sourceId,
      title: entry.title,
      sourcePath: null,
      createdAt: new Date(entry.editedAt),
    }));
    const resolver = buildLinkResolver(catalog);
    const origin = { documentId: "elsewhere", sourceId: "source-1", sourcePath: null };

    const queries = ["", "k", "kube", "cafe", "知", "２０", "under", "a", "c++", "what", "tab", "two spaces", "zzz"];
    let checked = 0;
    for (const query of queries) {
      for (const suggestion of rankSuggestions(list, query, 100)) {
        const links = extractDocumentLinks(`Before ${suggestion.link} after.`);
        expect(links, suggestion.link).toHaveLength(1);
        const resolution = resolver.resolve(links[0], origin);
        expect(resolution.status, suggestion.link).toBe("RESOLVED");
        if (resolution.status !== "RESOLVED") continue;
        checked += 1;
        if (suggestion.sameTitle === 0) expect(resolution.documentId, suggestion.link).toBe(suggestion.target.documentId);
        else expect(resolution.ambiguousWith, suggestion.link).toBe(suggestion.sameTitle);
      }
    }
    // Not a vacuous pass: most of what was typed found something.
    expect(checked).toBeGreaterThan(40);
  });

  it("holds for a title two documents share: the link goes to one of them, and the list said there were two", () => {
    const first = target("Runbook", day(1), "Team notes", "source-a");
    const second = target("Runbook", day(2), "Personal", "source-b");
    const catalog: CatalogDocument[] = [first, second].map((entry) => ({
      documentId: entry.documentId,
      sourceId: entry.sourceId,
      title: entry.title,
      sourcePath: null,
      createdAt: new Date(entry.editedAt),
    }));
    const resolver = buildLinkResolver(catalog);
    for (const suggestion of rankSuggestions([first, second], "runbook")) {
      const [link] = extractDocumentLinks(suggestion.link);
      const resolution = resolver.resolve(link, { documentId: "x", sourceId: "source-a", sourcePath: null });
      expect(resolution).toMatchObject({ status: "RESOLVED", ambiguousWith: 1 });
      expect([first.documentId, second.documentId]).toContain(resolution.status === "RESOLVED" ? resolution.documentId : "");
    }
  });

  it("explains each title that is not offered: written as a link, it would not resolve to itself", () => {
    const unwritable = ["a|b", "a#b", "a/b", "a.md", "a.MARKDOWN", "a [b]", "a]b", "a *b*", "`code`", "a <b> c", "", "   ", "a\nb"];
    for (const title of unwritable) {
      expect(isWritableAsWikiLink(title), JSON.stringify(title)).toBe(false);
      const links = extractDocumentLinks(`[[${title.trim()}]]`);
      const resolves = links.length === 1
        && buildLinkResolver([{ documentId: "self", sourceId: "s", title, sourcePath: null, createdAt: new Date(0) }])
          .resolve(links[0], { documentId: "x", sourceId: "s", sourcePath: null }).status === "RESOLVED"
        && normalizeLinkKey(links[0].target) === normalizeLinkKey(title);
      expect(resolves, JSON.stringify(title)).toBe(false);
    }
    for (const title of ["Kubernetes", "知識庫", "C++ notes", "What is a DAG?", "a.b.c", "under_score_name"]) {
      expect(isWritableAsWikiLink(title), title).toBe(true);
    }
  });
});
