/**
 * Content of the in-app guide "Bring your wiki into Knowledge Hub".
 *
 * Two content objects, one per locale, with the same seven sections in the
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
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; text: string };

export type GuideSection = { id: string; title: string; body: GuideBlock[] };
export type GuideContent = { title: string; intro: string; sections: GuideSection[] };
export type GuideLocale = "en" | "zh-TW";

export const GUIDE_SECTION_IDS = [
  "what-you-need",
  "from-obsidian",
  "from-a-tool",
  "import-preview-apply",
  "keep-in-sync",
  "read-search-agent",
  "limits",
] as const;

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
    title: "Bring your wiki into Knowledge Hub",
    intro:
      "Knowledge Hub imports a folder of Markdown files. This guide says what a folder needs to look like, what you will see while importing, and how to keep it up to date.",
    sections: [
      {
        id: "what-you-need",
        title: "What you need",
        body: [
          {
            kind: "p",
            text: "A folder of `.md` files. It can have subfolders; each Markdown file becomes one document, and the folders are kept as the tree.",
          },
          {
            kind: "p",
            text: "No folder yet? On the Import folder page, choose a language under Try with a sample wiki. It imports a small team handbook through the same Preview and Apply steps as your own folder, so you can see the whole flow before you use real files.",
          },
        ],
      },
      {
        id: "from-obsidian",
        title: "From an Obsidian vault",
        body: [
          {
            kind: "p",
            text: "An Obsidian vault works as it is: choose the vault folder. The `.obsidian` settings folder and any `.git` folder are always skipped.",
          },
          {
            kind: "p",
            text: "Obsidian's `[[wikilinks]]` are understood, including the shortest-path form `[[folder/Note]]`. Images and other attachments are recorded as references only (see Limits).",
          },
        ],
      },
      {
        id: "from-a-tool",
        title: "From a tool or agent that writes Markdown",
        body: [
          {
            kind: "p",
            text: "Any tool or agent that writes Markdown files into a folder works, as long as the result passes this checklist. Knowledge Hub does not need to know which tool wrote it.",
          },
          {
            kind: "ol",
            items: [
              "A title for every file: a `title` in the frontmatter, or a first `# H1` heading.",
              "Links in a form the importer resolves: `[[Title]]`, `[[folder/Note]]`, or a relative `.md` link such as `[text](../folder/note.md)`.",
              `Each Markdown file under ${fileLimit}.`,
              "No attachments to rely on: images and other non-Markdown files are kept as references only; there is no binary attachment storage.",
              "Relative paths without `..` segments, so every file stays inside the folder you choose.",
            ],
          },
          {
            kind: "p",
            text: "A title comes from the frontmatter `title`, then the first H1, then the file name. When the frontmatter title and the first H1 differ, the frontmatter title wins and Preview shows a warning.",
          },
          {
            kind: "p",
            text: "To link to a heading, use an anchor in GitHub's style, such as `#how-to-request-leave`. Headings written in any script keep their characters in the anchor. Links resolve only inside one workspace.",
          },
          {
            kind: "p",
            text: `The folders \`.git\` and \`.obsidian\` are always skipped. You can exclude up to ${MAX_EXCLUDED_PATHS} more paths in the import form, as exact relative paths with no wildcards.`,
          },
        ],
      },
      {
        id: "import-preview-apply",
        title: "Import, Preview, Apply",
        body: [
          {
            kind: "p",
            text: "Choose the folder. Knowledge Hub reads it in your browser and opens a Preview. Nothing in your workspace changes until you press Apply changes.",
          },
          {
            kind: "ul",
            items: [
              "Summary: how many documents are added, updated, moved or renamed, and archived.",
              "Changes, grouped as Added, Updated, Moved / Renamed, Archived / Restored and Unchanged, with a filter.",
              "Warnings: something worth a look. A warning does not stop Apply.",
              "Blockers: a problem that must be fixed first. Apply stays disabled while any blocker remains.",
            ],
          },
          {
            kind: "p",
            text: "Each diagnostic names the file it is about and says what is wrong. Expect exactly one warning from the sample wiki, on purpose: one file's frontmatter title differs from its first H1, so you can see how a warning reads.",
          },
          {
            kind: "code",
            text: "frontmatter.title differs from the first H1; frontmatter.title wins.",
          },
          {
            kind: "p",
            text: "Apply changes saves the result: new files become documents, changed files get a new revision, and files that are gone become archived.",
          },
        ],
      },
      {
        id: "keep-in-sync",
        title: "Keeping it in sync",
        body: [
          {
            kind: "p",
            text: "Importing is one-way. The folder on your computer is authoritative: edit your files there, not in Knowledge Hub. Imported documents are read-only in the Hub.",
          },
          {
            kind: "p",
            text: "To pick up changes, open the source, choose Update from folder, select the folder again, then Preview and Apply. Files you removed become archived documents; nothing is deleted for good.",
          },
          {
            kind: "p",
            text: "In Chrome or Edge, Knowledge Hub can remember the folder, and a one-click Check for changes button on the source re-scans it and opens a new Preview. Selecting the folder again always works.",
          },
        ],
      },
      {
        id: "read-search-agent",
        title: "Read, search, and Copy for Agent",
        body: [
          {
            kind: "p",
            text: "Imported documents open in the reader like any other. Links between them are clickable; a link is resolved when the page is read, so a link whose target no longer exists shows as unresolved.",
          },
          {
            kind: "p",
            text: "Search finds them by text. Advanced filters narrow the results by path, for example `docs/runbooks`, and by the date a document was updated (Updated from, Updated to).",
          },
          {
            kind: "p",
            text: "Copy for Agent builds one Markdown bundle from 1–20 documents you select, ready to paste into an agent.",
          },
        ],
      },
      {
        id: "limits",
        title: "Limits",
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
              ["Extra excluded paths", `Up to ${MAX_EXCLUDED_PATHS}, exact paths, no wildcards`],
              ["Always skipped", "`.git` and `.obsidian`"],
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
    title: "把你的維基帶進 Knowledge Hub",
    intro:
      "Knowledge Hub 可以匯入一個放滿 Markdown 檔案的資料夾。這份指南說明資料夾需要長什麼樣子、匯入時會看到什麼，以及如何讓內容保持最新。",
    sections: [
      {
        id: "what-you-need",
        title: "你需要準備什麼",
        body: [
          {
            kind: "p",
            text: "一個放著 `.md` 檔案的資料夾，裡面可以有子資料夾。每個 Markdown 檔案會成為一份文件，資料夾結構則會保留成目錄樹。",
          },
          {
            kind: "p",
            text: "還沒有資料夾嗎？在「匯入資料夾」頁面的「Try with a sample wiki」下選一種語言，就能匯入一份小型團隊手冊。它走的預覽（Preview）與套用（Apply）流程和你自己的資料夾完全相同，可以先看過整個流程，再換成真正的檔案。",
          },
        ],
      },
      {
        id: "from-obsidian",
        title: "從 Obsidian 資料庫匯入",
        body: [
          {
            kind: "p",
            text: "Obsidian 資料庫不必修改就能匯入：直接選取資料庫資料夾即可。`.obsidian` 設定資料夾與 `.git` 資料夾一律會被略過。",
          },
          {
            kind: "p",
            text: "系統看得懂 Obsidian 的維基連結（wikilink）`[[wikilinks]]`，包含最短路徑寫法 `[[folder/Note]]`。圖片等附件只會記錄為參照（詳見「限制」）。",
          },
        ],
      },
      {
        id: "from-a-tool",
        title: "從會寫出 Markdown 的工具或代理匯入",
        body: [
          {
            kind: "p",
            text: "只要工具或代理會把 Markdown 檔案寫進資料夾，產出的結果通過下面的檢查清單就可以匯入。Knowledge Hub 不需要知道是哪個工具寫的。",
          },
          {
            kind: "ol",
            items: [
              "每個檔案都有標題：frontmatter 裡的 `title`，或是第一個 `# H1` 標題。",
              "連結要用匯入程式讀得懂的寫法：`[[Title]]`、`[[folder/Note]]`，或相對路徑的 `.md` 連結，例如 `[文字](../folder/note.md)`。",
              `每個 Markdown 檔案都不超過 ${fileLimit}。`,
              "不要依賴附件：圖片與其他非 Markdown 檔案只會保留為參照，系統不儲存二進位附件。",
              "使用不含 `..` 的相對路徑，讓每個檔案都留在你所選的資料夾之內。",
            ],
          },
          {
            kind: "p",
            text: "標題的取用順序是：frontmatter 的 `title`、第一個 H1、檔案名稱。如果 frontmatter 標題與第一個 H1 不一致，會以 frontmatter 標題為準，預覽（Preview）也會顯示一則警告。",
          },
          {
            kind: "p",
            text: "要連到某個標題，請用 GitHub 風格的錨點，例如 `#how-to-request-leave`。任何語言的標題，錨點都會保留原本的文字。連結只在同一個工作區內解析。",
          },
          {
            kind: "p",
            text: `\`.git\` 與 \`.obsidian\` 資料夾一律會被略過。你還可以在匯入表單中再排除最多 ${MAX_EXCLUDED_PATHS} 個路徑，必須是精確的相對路徑，不支援萬用字元。`,
          },
        ],
      },
      {
        id: "import-preview-apply",
        title: "匯入、預覽、套用",
        body: [
          {
            kind: "p",
            text: "選取資料夾後，Knowledge Hub 會在你的瀏覽器中讀取，並開啟預覽（Preview）。在你按下套用（Apply）之前，工作區裡不會有任何變動。",
          },
          {
            kind: "ul",
            items: [
              "摘要：新增、更新、移動或重新命名、封存的文件各有幾份。",
              "變更清單：依「新增、更新、移動／重新命名、封存／還原、未變更」分組，並可篩選。",
              "警告：值得留意的地方，不會阻止套用。",
              "阻擋項目：必須先修正的問題，只要還有任何一項，就無法套用。",
            ],
          },
          {
            kind: "p",
            text: "每則診斷訊息都會指出是哪個檔案、哪裡有問題。範例知識庫刻意只會產生一則警告：其中一個檔案的 frontmatter 標題與第一個 H1 不同，讓你看看警告長什麼樣子。",
          },
          {
            kind: "code",
            text: "frontmatter.title differs from the first H1; frontmatter.title wins.",
          },
          {
            kind: "p",
            text: "按下「Apply changes」就會儲存結果：新檔案成為文件，有修改的檔案產生新版本，已不存在的檔案則會封存。",
          },
        ],
      },
      {
        id: "keep-in-sync",
        title: "保持同步",
        body: [
          {
            kind: "p",
            text: "匯入是單向的，以你電腦上的資料夾為準：要修改請在本機檔案裡改，不要在 Knowledge Hub 裡改。匯入後的文件在 Hub 中是唯讀的。",
          },
          {
            kind: "p",
            text: "要更新內容，請開啟該來源，選擇「Update from folder」，重新選取資料夾，再依序預覽（Preview）與套用（Apply）。你刪掉的檔案會變成封存文件，不會被永久刪除。",
          },
          {
            kind: "p",
            text: "在 Chrome 或 Edge 中，Knowledge Hub 可以記住該資料夾，來源頁面上的「Check for changes」按鈕只要點一下就會重新掃描並開啟新的預覽。重新選取資料夾則永遠可用。",
          },
        ],
      },
      {
        id: "read-search-agent",
        title: "閱讀、搜尋與 Copy for Agent",
        body: [
          {
            kind: "p",
            text: "匯入的文件和其他文件一樣在閱讀器中開啟，文件之間的連結可以直接點選。連結是在閱讀頁面時才解析，所以目標已不存在的連結會顯示為未解析。",
          },
          {
            kind: "p",
            text: "搜尋可以用文字找到這些文件。進階篩選可以依路徑縮小範圍，例如 `docs/runbooks`，也可以依文件的更新日期篩選（Updated from、Updated to）。",
          },
          {
            kind: "p",
            text: "Copy for Agent 會把你選取的 1–20 份文件整理成一份 Markdown，方便貼給代理使用。",
          },
        ],
      },
      {
        id: "limits",
        title: "限制",
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
              ["額外排除的路徑", `最多 ${MAX_EXCLUDED_PATHS} 個，須為精確路徑，不支援萬用字元`],
              ["一律略過", "`.git` 與 `.obsidian`"],
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
