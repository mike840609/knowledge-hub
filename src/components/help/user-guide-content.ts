import type {GuideContent,GuideLocale,GuideSection} from "@/components/imports/import-guide-content";

export type UserGuideAction = {target:"sample"|"sources"|"identity";label:string};
type GuideDetail = {title:string;items:string[];links?:UserGuideAction[]};
type UserGuideSection = GuideSection & {details:GuideDetail[];links:UserGuideAction[]};
type UserGuideContent = Omit<GuideContent,"sections"> & {sections:UserGuideSection[]};

function section(id:string,title:string,items:string[],details:GuideDetail[]=[],links:UserGuideAction[]=[]):UserGuideSection {
  return {id,title,body:[{kind:"ul",items}],details,links};
}

export function userGuideContent(locale:GuideLocale):UserGuideContent {
  if(locale==="zh-TW")return {
    title:"使用者操作手冊",
    intro:"My Space 個人工作區的日常操作。先看示意圖與實際畫面，再依需要展開細節；按鈕名稱與英文介面一致。",
    sections:[
      section("quick-start","五分鐘開始使用",[
        "到 Sources 選 Import folder，依上圖完成匯入。每次都選完整根目錄。",
        "預覽時展開更新項目查看差異；先解決阻擋問題，再 Apply。大量封存時先確認是否選錯目錄。",
        "成功後從結果頁開啟文章。沒有自己的資料夾？先試 Try with a sample wiki。",
      ],[{title:"預覽檢查與大量封存確認",items:[
        "掃描與上傳完成後，Import preview 會列出新增、更新、移動與封存。警告需檢查，阻擋問題必須先解決。",
        "大量封存可能要求輸入來源名稱。來源名稱只是顯示名稱，不能用來確認本機資料夾身分。範例 wiki 可在匯入頁選擇語言。",
        "只有 Apply 成功才會套用變更；取消預覽不會套用。結果頁也提供瀏覽來源的入口。",
        "選資料夾後，瀏覽器會讀取並上傳 Markdown 來產生預覽；預覽會過期，Apply 前不會成為文章。本機刪除的檔案在 Apply 後封存，不會永久刪除。",
      ]}],[{target:"sample",label:"試用範例 wiki"}]),
      section("sync","日常同步：檢查、預覽、套用",[
        "在本機修改同步文件，再到 Sources 點該來源最前面的同步圖示（Check for changes）。",
        "預覽差異與封存項目。大量文章消失時，先確認根目錄與排除規則。",
        "Apply 成功後查看結果；來源的同步歷史可回看批次變更。",
      ],[
        {title:"重新選資料夾、授權與取消同步",items:[
          "最前面是資料夾圖示（Update from folder）時，點它進入原有來源的更新頁並選 Choose folder，不必建立新來源。",
          "快速檢查依賴瀏覽器記住的資料夾與讀取授權。換裝置、換瀏覽器、清除網站資料或授權失效時，需重選完整根目錄；已套用文章仍保存在帳號。",
          "Cancel checking／Cancel import 可停止本次檢查或上傳，不會撤銷先前成功的同步。",
          "Folder Sync 文件以本機為準；網站建立的個人筆記則在網站編輯。",
        ]},
        {title:"排除路徑與檔案改名",links:[{target:"sources",label:"選擇來源以設定排除路徑"},{target:"identity",label:"查看 knowledge_id 設定與改名範例"}],items:[
          "Excluded paths 使用相對路徑，每行一個，最多 50 個，不支援萬用字元。隱藏檔案、隱藏資料夾與 node_modules 會被略過。",
          "規則在 Apply 成功後保存到來源，跨裝置沿用；已匯入文件被排除後會在套用時封存。",
          "同時改名與修改內容前，先讀匯入指南的 knowledge_id 說明。沒有穩定識別時，可能建立新文章並封存舊文章；收藏、歷史與分享仍留在舊文章。",
        ]},
      ],[{target:"sources",label:"開啟 Sources，選擇要更新的來源"}]),
      section("troubleshooting","遇到問題時",[
        "先依上圖處理授權、預覽或封存問題；其他情況可展開下方說明。",
        "無法確認 Apply 結果時，先查同步歷史；若提供重試，重試同一預覽。只有明確顯示 Nothing was changed 才能認定未套用。",
      ],[
        {title:"Apply 停用、檢查失敗或預覽過期",items:[
          "Apply 停用：依提示檢查 blockers、預覽過期、來源版本變更、工作區唯讀或大量封存確認未完成。",
          "檢查或上傳失敗：查看訊息，使用 Retry 或重新選資料夾。成功 Apply 前不會改變來源內容。",
          "預覽過期時選 Refresh preview；來源被其他同步更新時重新建立預覽。兩者都需重新檢查差異，不能沿用舊確認。",
          "瀏覽器對記住資料夾的支援不同；授權失效請在原有來源重選完整根目錄，不要重複匯入。",
        ]},
        {title:"文章找不到、連結或圖片無法開啟",items:[
          "先確認搜尋來源、原始路徑與封存項目。封存不會刪除本機檔案。",
          "同步文章：修正本機文件或排除規則，再檢查並 Apply。個人筆記：從封存檢視還原。",
          "連結或圖片問題：查看來源健康清單、匯入警告與相對路徑。附件目前以參照與 metadata 為主，不保證本機圖片或附件能在線上開啟。",
        ]},
        {title:"Insights 無法載入",items:[
          "選 Try again 或 Refresh。仍可從 Home、Knowledge 與 Sources 閱讀與操作；統計載入失敗不代表文章遺失。",
        ]},
      ]),
      section("reading","閱讀、搜尋與整理",[
        "用 Search 找文章；同名時對照來源與原始路徑。Graph 可探索文章連結。",
        "在文件列的 ⋯ 選單選 Add to favorites 收藏（Home 列表也可點星號）；回 Home 的 Drafts 繼續寫作、Recent 繼續閱讀。",
        "選 New note 建立個人筆記；從文章選單使用封存、還原與歷史版本。",
      ],[{title:"未讀、裝置紀錄與草稿的差別",items:[
        "開啟目前版本會更新閱讀紀錄，不代表已讀完；文章再次同步更新後可能重新出現未讀。",
        "收藏、草稿與編輯紀錄保存到帳號；Recent 裡的最近開啟保存在裝置，換瀏覽器可能不同。",
        "未保存草稿不列入文章統計或匯出。",
      ]},{title:"搜尋篩選與 Copy for Agent",items:[
        "Search 的進階篩選可依路徑（例如 docs/runbooks）與更新日期（Updated from／Updated to）縮小範圍。",
        "Copy for Agent 只在 My Space 提供：選 1–20 份文件整理成一份 Markdown，方便貼給代理。",
      ]}]),
      section("insights","Insights 的數字",[
        "從側欄 Insights 開啟統計；點 Recent changes 的 Added、Updated 或 Archived 可開啟對應的文章清單。",
        "用 Refresh 更新統計。Updated 是查詢時間；Last synced 才是成功同步時間。",
      ],[{title:"統計範圍與未讀數的計算",items:[
        "Insights 顯示目前知識組成、未讀更新、來源分布與同步狀態；來源分布也列出各資料夾已開啟過的文件數。",
        "7 days／30 days 只影響閱讀活動與近期變更，不是整頁的歷史快照。",
        "新增、更新與封存各自計算期間內不同文章，同篇可跨分類；活躍文章總數不含草稿與封存內容。",
        "未讀數只計入有永久變更紀錄的目前同步版本；舊匯入缺少紀錄時會提示，不補造歷史。",
      ]}]),
      section("sharing-export","分享、匯出與使用範圍",[
        "分享前確認內容可公開給連結持有人；對方免登入即可閱讀，也會看到文章後續變更。",
        "在文章的 Share link 管理期限與撤銷；到 Shares 查看 My shares、Saved shares，或在 Discussions 追蹤你參與的討論。",
        "登入後可留言、回覆或按 Save（需系統啟用相關功能）。儲存的是連結，不是文章副本。",
        "Home 更多操作 → Export Markdown ZIP：含已保存與封存筆記，不含草稿、歷史版本或附件，不能當作完整備份。",
      ],[
        {title:"留言權限與已儲存分享",items:[
          "有效連結可免登入閱讀未隱藏的評論；新增與回覆需要可信登入身分及啟用寫入。公司登入未設定時仍可閱讀評論。",
          "擁有者可回覆、解決或隱藏留言；評論不修改 Markdown，也不影響 Folder Sync。",
          "儲存分享不會加入自己的最愛。到期或失效的紀錄仍可 Remove；移除不會撤銷對方連結。撤銷後，原連結無法再開啟文件。",
        ]},
        {title:"Team workspace 的適用範圍",items:[
          "本手冊以 My Space 為主。Team 是否可用取決於部署設定，操作受角色與工作區狀態限制；唯讀或沒有權限時請依介面提示處理。",
        ]},
      ]),
    ],
  };
  return {
    title:"User guide",
    intro:"Daily tasks in My Space. Start with each diagram and screen, then expand details as needed. Button names match the English interface.",
    sections:[
      section("quick-start","Get started in five minutes",[
        "In Sources, select Import folder and follow the diagram. Always choose the complete root folder.",
        "Expand updated items to inspect differences. Resolve blockers before Apply; check the root if many articles are marked archived.",
        "Open an article from the result page. No folder yet? Try with a sample wiki first.",
      ],[{title:"Preview checks and large-archive confirmation",items:[
        "After scanning and uploading, Import preview lists added, updated, moved and archived items. Review warnings and resolve blockers.",
        "A large archive may require entering the source name. This is a display name, not proof of folder identity. Sample wikis offer a language choice on the import page.",
        "Only a successful Apply changes your articles; canceling a preview does not apply it. The result page also links to the source.",
        "After you choose a folder, the browser reads it and uploads the Markdown to build the preview; a preview expires, and nothing becomes an article before Apply. Files deleted locally are archived after Apply, never deleted for good.",
      ]}],[{target:"sample",label:"Try the sample wiki"}]),
      section("sync","Daily sync: check, preview, apply",[
        "Edit synced files locally, then in Sources select the sync icon at the start of the source's row (Check for changes).",
        "Review differences and archives. If many articles disappear, check the root and exclusions first.",
        "After Apply succeeds, check the result. Source sync history retains batch changes.",
      ],[
        {title:"Folder permission, reselection and cancellation",items:[
          "If the row starts with a folder icon (Update from folder), select it to open the existing source's update page, then Choose folder. Do not create a new source.",
          "Quick checks depend on this browser's remembered folder and read permission. A new device, browser, cleared site data or expired permission requires selecting the complete root again. Applied articles remain in your account.",
          "Cancel checking / Cancel import stops this check or upload without undoing previous successful syncs.",
          "Local files remain authoritative for Folder Sync; personal notes created in the Hub are edited on the website.",
        ]},
        {title:"Excluded paths and renaming files",links:[{target:"sources",label:"Choose a source to configure excluded paths"},{target:"identity",label:"Read knowledge_id setup and renaming examples"}],items:[
          "Excluded paths are relative, one per line, up to 50, without wildcards. Hidden files, hidden folders and node_modules are skipped.",
          "Rules are saved to the source after successful Apply and used across devices. Excluding an imported document archives it when applied.",
          "Before renaming and editing together, read the import guide's knowledge_id instructions. Without stable identity, a new article may be created and the old one archived; favorites, history and shares stay with the old article.",
        ]},
      ],[{target:"sources",label:"Open Sources to choose a source to update"}]),
      section("troubleshooting","Troubleshooting",[
        "Use the diagram for folder permission, preview and archive issues. Expand the cases below for other problems.",
        "If the Apply outcome is uncertain, inspect sync history first. If offered, retry the same preview. Only an explicit Nothing was changed error confirms that this attempt was not applied.",
      ],[
        {title:"Disabled Apply, failed checks or expired previews",items:[
          "Disabled Apply: follow the message for blockers, expiry, a changed source version, read-only access or incomplete large-archive confirmation.",
          "Failed check or upload: inspect the message, use Retry or choose the folder again. Source content changes only after successful Apply.",
          "For expiry, select Refresh preview; for another sync's changes, build a fresh preview. Review differences again rather than reusing the old confirmation.",
          "Browser support for remembered folders varies. Renew permission by selecting the existing source's complete root, not by importing a duplicate source.",
        ]},
        {title:"Missing articles, unresolved links or images",items:[
          "Check the source, original path and archived items. Archiving does not delete local files.",
          "For synced articles, correct local files or exclusions and Apply a fresh preview. Restore personal notes through the archived view.",
          "For links or images, inspect source health, import warnings and relative paths. Attachments currently retain references and metadata; local images and attachments are not guaranteed to open online.",
        ]},
        {title:"Insights unavailable",items:[
          "Use Try again or Refresh. Home, Knowledge and Sources remain available for reading and operations; a failed statistics request does not mean articles were lost.",
        ]},
      ]),
      section("reading","Read, search and organize",[
        "Find articles with Search; use source and original path to distinguish identical titles. Explore links in Graph.",
        "Save a favorite with Add to favorites in a document row's ⋯ menu (on Home, the star does the same); Drafts holds unfinished writing and Recent picks up where you left off.",
        "Create a personal note with New note. Use article actions for archive, restore and revision history.",
      ],[{title:"Unread updates, device history and drafts",items:[
        "Opening the current revision updates its read record, not whether you finished reading. A later synced revision may become unread again.",
        "Favorites, drafts and edits follow your account. Recently opened articles in Recent are stored on this device and may differ in another browser.",
        "Unsaved drafts are excluded from article counts and export.",
      ]},{title:"Search filters and Copy for Agent",items:[
        "Advanced Search filters narrow results by path (for example docs/runbooks) and by update date (Updated from / Updated to).",
        "Copy for Agent, in My Space only, builds one Markdown bundle from 1–20 documents you select, ready to paste into an agent.",
      ]}]),
      section("insights","Understand Insights",[
        "Open Insights from the sidebar; under Recent changes, Added, Updated or Archived opens the matching article list.",
        "Use Refresh for current statistics. Updated is the query time; Last synced is the successful sync time.",
      ],[{title:"Statistics scope and unread counts",items:[
        "Insights shows current knowledge composition, unread updates, source distribution and sync status. Distribution also shows how many documents you have opened in each folder.",
        "7 days / 30 days affects reading activity and recent changes only, not a historical snapshot of the whole page.",
        "Added, updated and archived each count distinct articles in the period; one may appear in several categories. Active totals exclude drafts and archived content.",
        "Unread counts require recorded changes on the current synced revision. Missing legacy history is explained rather than invented.",
      ]}]),
      section("sharing-export","Share, export and workspace scope",[
        "Before sharing, confirm the content is suitable for link holders. They can read without signing in and see later article changes.",
        "Manage expiry and revocation in Share link. Open Shares for My shares, Saved shares, or Discussions to follow the discussions you take part in.",
        "Sign in to comment, reply or choose Save where enabled. Saving retains a link, not an article copy.",
        "Home's more-actions menu → Export Markdown ZIP includes saved and archived notes, excluding drafts, revision history and attachments. It is not a full backup.",
      ],[
        {title:"Comment permissions and saved shares",items:[
          "A valid link allows anonymous reading of visible comments. Adding comments and replies requires trusted sign-in and enabled writes. Reading still works without configured company sign-in.",
          "Owners can reply, resolve and hide comments without changing Markdown or Folder Sync.",
          "Saving a share does not add a workspace favorite. Expired or unavailable entries remain removable; Remove does not revoke the sender's link. Revoked links can no longer open the article.",
        ]},
        {title:"Team workspace scope",items:[
          "This guide focuses on My Space. Team availability depends on deployment settings; operations depend on roles and workspace state. Follow read-only or access-denied messages.",
        ]},
      ]),
    ],
  };
}
