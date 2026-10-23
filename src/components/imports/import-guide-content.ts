/**
 * Content of "Folder format and import rules", the user guide's reference part
 * (`/help#format-reference`): what a folder must look like.
 *
 * Two content objects, one per locale, with the same five sections in the
 * same order. Every number the server enforces comes in as `limits` (read from
 * `importRuntimeConfig()` by the page), so the guide cannot disagree with what
 * the importer does. Text is plain; a `backtick span` renders as inline code.
 */

export type GuideLimits = {
  maxManifestEntries: number;
  maxPathBytes: number;
  maxMarkdownFileBytes: number;
  maxMarkdownTotalBytes: number;
};

export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "note"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; text: string };

export type GuideSection = { id: string; title: string; body: GuideBlock[] };
export type GuideContent = { title: string; intro: string; sections: GuideSection[] };
export type GuideLocale = "en" | "zh-TW";

export const GUIDE_SECTION_IDS = ["example", "checklist", "titles-links", "knowledge-id", "limits"] as const;

/** The importer accepts at most this many extra excluded paths (see import-scope.ts). */
const MAX_EXCLUDED_PATHS = 50;

const UNITS = [
  { name: "GiB", size: 1024 ** 3 },
  { name: "MiB", size: 1024 ** 2 },
  { name: "KiB", size: 1024 },
] as const;

/** `5 MiB`, `2 KiB`, `1.5 KiB`, `512 B`: binary units, one decimal at most. */
export function formatGuideBytes(bytes: number): string {
  const unit = UNITS.find((candidate) => bytes >= candidate.size);
  if (!unit) return `${bytes} B`;
  const value = Math.round((bytes / unit.size) * 10) / 10;
  return `${value} ${unit.name}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function english(limits: GuideLimits): GuideContent {
  const fileLimit = formatGuideBytes(limits.maxMarkdownFileBytes);
  return {
    title: "Folder format and import rules",
    intro:
      "What a folder of Markdown files needs for Knowledge Hub to import it: the files, the links and the limits.",
    sections: [
      {
        id: "example",
        title: "A complete example",
        body: [
          {
            kind: "p",
            text: "A folder like this imports as it is. An Obsidian vault already fits: choose the vault folder, and its `.obsidian` settings folder is skipped.",
          },
          {
            kind: "code",
            text: "wiki/                     <- choose this folder\n├── index.md\n├── handbook/\n│   ├── leave-policy.md\n│   └── onboarding.md\n└── .obsidian/            <- skipped",
          },
          { kind: "p", text: "`handbook/leave-policy.md`, with every form this guide describes:" },
          {
            kind: "code",
            text: "---\ntitle: Leave policy\nknowledge_id: leave-policy\n---\n# Leave policy\n\nAsk your manager first. See [[Onboarding]] and [the handbook](../index.md).\n\n## How to request leave",
          },
          {
            kind: "p",
            text: "Each Markdown file becomes one document and the folders become the tree. `knowledge_id` is optional; see below. No folder yet? Try with a sample wiki on the Import folder page imports a small handbook through the same Preview and Apply as your own folder.",
          },
        ],
      },
      {
        id: "checklist",
        title: "Checklist for tools and agents",
        body: [
          {
            kind: "p",
            text: "Any tool or agent that writes Markdown files into a folder works, as long as the result passes this checklist. Knowledge Hub does not need to know which tool wrote it.",
          },
          {
            kind: "ol",
            items: [
              "A title for every file: a `title` in the frontmatter, or a first `# H1` heading.",
              "Links in a form Knowledge Hub resolves: `[[Title]]`, `[[folder/Note]]`, or a relative `.md` link such as `[text](../folder/note.md)`.",
              `No Markdown file larger than ${fileLimit}.`,
              "No attachments to rely on: images and other non-Markdown files are kept as references only; there is no binary attachment storage.",
              "Keep every file inside the folder you choose (links between files may still use `../`).",
              "Do not rely on files or folders whose names start with a dot, or on `node_modules` folders and `Thumbs.db` files, at any depth: a folder such as `.wiki/` is skipped without a warning. Skipped paths are never read or uploaded, and they do not count toward the file-count or size limits.",
            ],
          },
        ],
      },
      {
        id: "titles-links",
        title: "Titles, links and anchors",
        body: [
          {
            kind: "ul",
            items: [
              "Title: the frontmatter `title`, then the first H1, then the file name. When the frontmatter title and the first H1 differ, the frontmatter title wins and Preview shows a warning.",
              "`[[Title]]` links by title. Add the folder, `[[folder/Note]]`, when two notes share a name; part of the path or the full path from the folder you import both work.",
              "A relative Markdown link, such as `[text](../folder/note.md)`, links by path.",
              "To link to a heading, use an anchor in GitHub's style, such as `#how-to-request-leave`. Headings written in any script keep their characters in the anchor.",
              "Links resolve only inside one workspace, when the page is read: a link whose target no longer exists shows as unresolved.",
            ],
          },
        ],
      },
      {
        id: "knowledge-id",
        title: "Keep a document through renames",
        body: [
          {
            kind: "note",
            text: "If you rename or move a file and also edit it before the next sync, it becomes a new document: the old one is archived, and its share links, favorites and history stay with the archived copy.",
          },
          {
            kind: "p",
            text: "Each sync recognizes a file by its path, or, when the path changed, by unchanged content. A `knowledge_id` keeps the document the same whatever changes:",
          },
          {
            kind: "ol",
            items: [
              "Add a `knowledge_id` to the frontmatter: a text value up to 512 characters, unique within the folder. Quote it if it is only digits, such as `\"2024\"`, or the import refuses it as a number.",
              "Sync that change on its own, before renaming, so that sync still matches the file by its path.",
              "Keep it from then on: removing or changing it, or reusing it in another file, blocks the next Preview.",
            ],
          },
          {
            kind: "code",
            text: "---\nknowledge_id: leave-policy\n---\n# How to request leave",
          },
        ],
      },
      {
        id: "limits",
        title: "Limits and skipped paths",
        body: [
          { kind: "p", text: "These are the limits this server enforces right now." },
          {
            kind: "table",
            head: ["Limit", "Value"],
            rows: [
              ["Files in one import", formatCount(limits.maxManifestEntries)],
              ["Length of one file path", formatGuideBytes(limits.maxPathBytes)],
              ["Size of one Markdown file", fileLimit],
              ["Total size of Markdown files in one import", formatGuideBytes(limits.maxMarkdownTotalBytes)],
              ["Extra excluded paths", `Up to ${MAX_EXCLUDED_PATHS}, exact relative paths, no wildcards; set in the import form`],
              ["Always skipped", "Names that start with a dot (including `.git` and `.obsidian`), `node_modules`, `Thumbs.db`"],
              ["Assets and attachments", "References only; no binary attachment storage"],
            ],
          },
        ],
      },
    ],
  };
}

function traditionalChinese(limits: GuideLimits): GuideContent {
  const fileLimit = formatGuideBytes(limits.maxMarkdownFileBytes);
  return {
    title: "資料夾格式與匯入規則",
    intro:
      "Knowledge Hub 能匯入的 Markdown 資料夾需要符合什麼：檔案、連結與限制。",
    sections: [
      {
        id: "example",
        title: "完整範例",
        body: [
          {
            kind: "p",
            text: "下面這樣的資料夾可以直接匯入。Obsidian 筆記庫（vault）不用修改就符合：選筆記庫資料夾即可，`.obsidian` 設定資料夾會被略過。",
          },
          {
            kind: "code",
            text: "wiki/                     <- 選這個資料夾\n├── index.md\n├── handbook/\n│   ├── leave-policy.md\n│   └── onboarding.md\n└── .obsidian/            <- 略過",
          },
          { kind: "p", text: "`handbook/leave-policy.md` 的內容，包含這份指南提到的所有寫法：" },
          {
            kind: "code",
            text: "---\ntitle: 請假規定\nknowledge_id: leave-policy\n---\n# 請假規定\n\n先和主管確認。另見 [[新人報到]] 與 [團隊手冊](../index.md)。\n\n## 怎麼申請請假",
          },
          {
            kind: "p",
            text: "每個 Markdown 檔案會成為一份文件，資料夾結構則成為目錄樹。`knowledge_id` 可省略，說明見下方。還沒有資料夾嗎？在 Import folder 頁面選「Try with a sample wiki」，就能用和自己資料夾相同的預覽（Preview）與套用（Apply）流程匯入一份小型手冊。",
          },
        ],
      },
      {
        id: "checklist",
        title: "給工具與代理的檢查清單",
        body: [
          {
            kind: "p",
            text: "只要工具或代理會把 Markdown 檔案寫進資料夾，產出的結果通過下面的檢查清單就可以匯入。Knowledge Hub 不需要知道是哪個工具寫的。",
          },
          {
            kind: "ol",
            items: [
              "每個檔案都有標題：frontmatter 裡的 `title`，或是第一個 `# H1` 標題。",
              "連結要用 Knowledge Hub 解析得了的寫法：`[[Title]]`、`[[folder/Note]]`，或相對路徑的 `.md` 連結，例如 `[文字](../folder/note.md)`。",
              `沒有任何 Markdown 檔案大於 ${fileLimit}。`,
              "不要依賴附件：圖片與其他非 Markdown 檔案只會保留為參照，系統不儲存二進位附件。",
              "讓每個檔案都留在你所選的資料夾之內（檔案之間的連結仍然可以使用 `../`）。",
              "不要依賴名稱以點開頭的檔案或資料夾，也不要依賴任何層級的 `node_modules` 資料夾與 `Thumbs.db` 檔案：像 `.wiki/` 這樣的資料夾會被略過，而且不會出現警告。被略過的路徑不會被讀取或上傳，也不計入檔案數與大小限制。",
            ],
          },
        ],
      },
      {
        id: "titles-links",
        title: "標題、連結與錨點",
        body: [
          {
            kind: "ul",
            items: [
              "標題：依序取 frontmatter 的 `title`、第一個 H1、檔案名稱。frontmatter 標題與第一個 H1 不一致時，以 frontmatter 標題為準，預覽（Preview）也會顯示一則警告。",
              "維基連結（wikilink）`[[標題]]` 以標題連結。兩份筆記同名時加上資料夾，寫成 `[[folder/Note]]`；可以寫部分路徑，也可以寫從匯入資料夾起算的完整路徑。",
              "相對路徑的 Markdown 連結，例如 `[文字](../folder/note.md)`，以路徑連結。",
              "要連到某個標題，請用 GitHub 風格的錨點，例如 `#how-to-request-leave`。任何語言的標題，錨點都會保留原本的文字。",
              "連結只在同一個工作區內、於閱讀頁面時解析：目標已不存在的連結會顯示為未解析。",
            ],
          },
        ],
      },
      {
        id: "knowledge-id",
        title: "改名或移動時保持同一份文件",
        body: [
          {
            kind: "note",
            text: "如果在下次同步前同時改名（或移動）並編輯某個檔案，它會變成一份新文件：舊文件會被封存，它的分享連結、收藏與歷史紀錄都留在封存的那一份。",
          },
          {
            kind: "p",
            text: "每次同步會用路徑辨認同一個檔案；路徑改變時，則用沒有變動的內容來辨認。加上 `knowledge_id`，不論怎麼改，文件都會是同一份：",
          },
          {
            kind: "ol",
            items: [
              "在 frontmatter 加上 `knowledge_id`：512 個字元以內、在資料夾中不重複的文字值。若只有數字，例如 `\"2024\"`，請加上引號，否則會被當成數字而無法匯入。",
              "先單獨同步這次變更，再改名，讓那次同步仍能用路徑認出這個檔案。",
              "之後請一直保留：移除或修改它，或在另一個檔案重複使用，都會讓下一次預覽無法套用。",
            ],
          },
          {
            kind: "code",
            text: "---\nknowledge_id: leave-policy\n---\n# 如何請假",
          },
        ],
      },
      {
        id: "limits",
        title: "限制與略過規則",
        body: [
          { kind: "p", text: "以下是此伺服器目前實際採用的限制。" },
          {
            kind: "table",
            head: ["限制", "數值"],
            rows: [
              ["一次匯入的檔案數", formatCount(limits.maxManifestEntries)],
              ["單一檔案路徑的長度", formatGuideBytes(limits.maxPathBytes)],
              ["單一 Markdown 檔案的大小", fileLimit],
              ["一次匯入的 Markdown 檔案總大小", formatGuideBytes(limits.maxMarkdownTotalBytes)],
              ["額外排除的路徑", `最多 ${MAX_EXCLUDED_PATHS} 個，須為精確的相對路徑，不支援萬用字元；在匯入表單設定`],
              ["一律略過", "名稱以點開頭的路徑（包含 `.git` 與 `.obsidian`）、`node_modules`、`Thumbs.db`"],
              ["資源與附件", "只保留參照，不儲存二進位附件"],
            ],
          },
        ],
      },
    ],
  };
}

export function guideContent(locale: GuideLocale, limits: GuideLimits): GuideContent {
  return locale === "zh-TW" ? traditionalChinese(limits) : english(limits);
}
