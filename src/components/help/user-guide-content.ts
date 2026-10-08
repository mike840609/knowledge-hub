import type {GuideContent,GuideLocale,GuideSection} from "@/components/imports/import-guide-content";

function section(id:string,title:string,items:string[]):GuideSection {
  return {id,title,body:[{kind:"ol",items}]};
}

export function userGuideContent(locale:GuideLocale):GuideContent {
  if(locale==="zh-TW")return {
    title:"使用者操作手冊",
    intro:"從第一次匯入到日常更新：依你正在做的事查閱。介面按鈕以英文名稱標示，方便對照。這份手冊以 My Space 個人工作區為主。",
    sections:[
      section("quick-start","五分鐘開始使用",[
        "在 Home 選 Import folder，再選 Choose folder。選擇包含 Markdown 文件的完整根目錄，例如 wiki；之後更新也選同一個根目錄，不要只選變更的子資料夾。",
        "沒有自己的 folder？在匯入頁的 Try with a sample wiki 選擇語言，用範例體驗相同流程。來源名稱只是顯示名稱，不代表本機 folder 的身分。",
        "等待掃描與上傳完成，進入 Import preview。檢查新增、更新、移動與封存；更新項目可展開查看內容差異。警告可供檢查，阻擋問題必須先解決。",
        "確認範圍後選 Apply changes。只有 Apply 成功才會套用這次變更；取消預覽不會套用。大量封存時先確認是否選错目錄，必要時需輸入來源名稱。",
        "成功頁顯示本次結果，從閱讀更新或瀏覽來源的入口開啟文章。回 Home 可搜尋、查看 My folders、繼續閱讀與 Updates。",
      ]),
      section("sync","日常同步：檢查、預覽、套用",[
        "先在本機修改來源文件。Folder Sync 文件以本機內容為準；網站上的個人筆記則由網站編輯。",
        "在 Home 的 My folders 或 Sources 找到來源，點 Check for changes。若沒有快速檢查圖示，進入來源的更新頁並選 Choose folder。",
        "快速檢查依賴目前瀏覽器記住的 folder 與讀取授權。換裝置、換瀏覽器、清除網站資料或授權失效時，需要重新選完整 folder；已套用的文章仍保存於帳號。",
        "Check for changes 只掃描並建立預覽，不是背景自動同步。Awaiting Apply 表示尚未套用；Last synced 表示最後成功套用時間，不是剛掃描的時間。",
        "查看內容差異與封存項目。若大量文章消失，先回頭確認根目錄與排除規則，再決定是否 Apply。",
        "Excluded paths 使用相對路徑，每行一個，最多 50 個，不支援萬用字元。隱藏檔案、隱藏資料夾與 node_modules 會被略過。規則在 Apply 成功後保存到來源，跨裝置沿用；已匯入文件被排除後會在套用時封存。",
        "按 Apply changes，確認結果摘要；從來源的同步歷史回看批次變更。檢查或上傳中可用 Cancel checking／Cancel import 停止，這不會撤銷之前成功的同步。",
        "若會同時改名與修改內容，先閱讀匯入指南的 knowledge_id 說明。沒有穩定識別時，可能產生新文章並封存舊文章，收藏、歷史與分享仍留在舊文章。",
      ]),
      section("troubleshooting","遇到問題時",[
        "看不到快速檢查圖示或要求授權：進入該來源更新頁重新選完整 folder。不同瀏覽器對記住 folder 的支援不同；不要為了重新授權再匯入一個新來源。",
        "預覽過期：選 Refresh preview 重新掃描，再檢查並套用。舊預覽不能繼續使用。",
        "來源已被另一個同步更新：重新建立預覽，確認這次的新差異。不要沿用上一個批次的確認內容。",
        "Apply 按鈕停用：檢查是否有 blockers、預覽過期、來源版本變更、工作區唯讀或大量封存確認未完成。依畫面提示處理。",
        "檢查或上傳失敗：查看訊息，使用 Retry 或重新選 folder。只有預覽建立並成功 Apply 後才會改變來源內容。",
        "套用結果無法確認：先查看來源的同步歷史。畫面提供重試時，可重試同一個預覽以恢復結果；不要直接建立重複來源。只有明確顯示 Nothing was changed 的錯誤，才能認定這次未套用。",
        "文章找不到：確認搜尋來源與路徑，並查看封存項目。封存不會刪除本機檔案；同步文章的恢復應先修正本機文件或排除規則，再檢查並 Apply。個人筆記可從封存檢視還原。",
        "連結無法解析或圖片不顯示：查看來源的健康清單、匯入警告與原始相對路徑。目前附件以參照與 metadata 為主，並不保證本機圖片或附件能完整在線上開啟。",
        "Insights 暫時無法載入：選 Try again 或 Refresh。仍可從 Home、Knowledge 與 Sources 閱讀與操作；不要把統計載入失敗理解成文章遺失。",
      ]),
      section("reading","閱讀、搜尋與整理",[
        "Home 是日常入口；Knowledge 瀏覽文章，Sources 管理來源，Graph 探索連結。用搜尋與來源／原始路徑辨識同名文章。",
        "星號可加入或移除收藏，收藏保存到帳號。Continue reading／最近閱讀目前保存在裝置；換瀏覽器時不一定出現相同清單。",
        "Unread updates 依文章版本記錄，開啟目前版本後會更新閱讀紀錄，不代表系統判定你已讀完。文章再次同步更新後可能重新出現未讀。",
        "從 New note 建立個人筆記。草稿與已保存文章不同，未保存草稿不列入文章統計或匯出。封存、還原與歷史版本操作請依文章可用的選單進行。",
      ]),
      section("insights","Home 與 Insights 的數字",[
        "Home 提供文章、同步來源、收藏與未讀摘要；點數字可進對應清單，View all insights 開啟完整分析。",
        "Insights 顯示目前知識組成、未讀更新、來源分布（含各資料夾已開啟過的文件數）與同步狀態。頂部 7 days／30 days 只影響閱讀活動與近期變更，不會把整頁切成歷史快照。",
        "新增、更新與封存各自計算期間內不同文章，同一篇可能出現在多個分類，因此三者相加不是文章總數。草稿與已封存內容不列入活躍文章總數。",
        "未讀數只計入有永久變更紀錄的目前同步版本；舊匯入缺少紀錄時會提示，不補造歷史。Refresh 更新統計，頁尾 Updated 是查詢時間，來源的 Last synced 才是同步時間。",
      ]),
      section("sharing-export","分享、匯出與使用範圍",[
        "My Space 是個人工作區。建立文章分享連結後，持有連結的人可免登入閱讀，並看到文章後續變更；請先確認內容可以公開給連結持有人。",
        "在文章 Share link 對話框管理期限與撤銷；Shares 可檢查目前分享狀態。撤銷後，既有連結無法再開啟文件。",
        "Home 的更多操作選單提供 Export Markdown ZIP。匯出包含已保存與封存的筆記；不包含草稿、歷史版本或附件，不應當作完整系統備份。",
        "Team workspace 是否可用由部署設定決定，操作也受角色與工作區狀態限制。Home、Insights 與本手冊的個人流程不代表 Team 成員一定能使用；唯讀或沒有權限時請依介面提示處理。",
      ]),
    ],
  };
  return {
    title:"User guide",
    intro:"From your first import to daily updates. Find the steps for your current task. This guide focuses on My Space, your personal workspace.",
    sections:[
      section("quick-start","Get started in five minutes",[
        "On Home, select Import folder, then Choose folder. Select the complete Markdown root, such as wiki. Use the same root for future updates, not just a changed subfolder.",
        "No folder yet? Choose a language under Try with a sample wiki on the import page. Source name is a display name, not proof of folder identity.",
        "Wait for scanning and uploading to finish. In Import preview, review added, updated, moved and archived items; expand updated items to inspect content differences. Warnings need review; blockers must be resolved.",
        "Select Apply changes only after checking the scope. Changes take effect when Apply succeeds; canceling a preview does not apply it. For a large archive, verify the root first and enter the source name if requested.",
        "The result page summarizes the sync and offers reading and source links. Return to Home for search, My folders, Continue reading and Updates.",
      ]),
      section("sync","Daily sync: check, preview, apply",[
        "Edit synced documents in your local folder, which remains authoritative. Personal notes written in the Hub are edited on the website.",
        "Find the source in Home's My folders or Sources and select Check for changes. If the quick-check icon is unavailable, open the source's update page and choose the folder.",
        "Quick checks depend on a folder remembered by this browser and its read permission. A new device, browser, cleared site data or expired permission requires selecting the full folder again. Applied documents remain in your account.",
        "Check for changes scans and builds a preview; there is no automatic background sync. Awaiting Apply means changes are pending. Last synced is the last successful Apply time, not the most recent scan.",
        "Review content differences and archives. If many documents disappear, check the root and exclusions before applying.",
        "Excluded paths are relative, one per line, up to 50, without wildcards. Hidden files, hidden folders and node_modules are skipped. Rules are saved to the source after successful Apply and used across devices. Excluding an imported document archives it when applied.",
        "Apply changes and check the result; source sync history retains batch changes. Cancel checking or Cancel import stops the current check or upload, without undoing earlier successful syncs.",
        "Before renaming and editing a file together, read the import guide's knowledge_id instructions. Without stable identity, a new document may replace an archived one; favorites, history and shares remain with the old document.",
      ]),
      section("troubleshooting","Troubleshooting",[
        "Missing quick-check icon or denied folder permission: open the existing source's update page and select its full folder again. Browser support for remembering folders varies. Do not create a duplicate source just to renew permission.",
        "Expired preview: select Refresh preview, scan again, review and Apply. The expired preview cannot be used.",
        "Source changed by another sync: build a fresh preview and review the new differences instead of reusing the old confirmation.",
        "Disabled Apply: check for blockers, expiry, changed source version, read-only access or an incomplete large-archive confirmation. Follow the message shown.",
        "Check or upload failed: inspect the message, use Retry or choose the folder again. Source content changes only after a preview is successfully applied.",
        "Apply outcome could not be confirmed: inspect source sync history first. If offered, retry the same preview to recover its result rather than creating another source. Only an explicit Nothing was changed error confirms that this attempt was not applied.",
        "Missing article: check its source and original path, then archived items. Archiving does not delete local files. Restore synced content by correcting local files or exclusions and applying a fresh preview; restore personal notes through the archived view.",
        "Unresolved links or missing images: inspect source health, import warnings and relative paths. Attachments currently retain references and metadata; local images and attachments are not guaranteed to be readable online.",
        "Insights unavailable: use Try again or Refresh. Home, Knowledge and Sources remain your reading and operation entries; a failed statistics request does not mean articles were lost.",
      ]),
      section("reading","Read, search and organize",[
        "Home is your daily entry. Knowledge browses articles, Sources manages origins and Graph explores links. Search and source/path information distinguish articles with identical titles.",
        "Use the star to add or remove favorites, saved to your account. Continue reading and recent documents are stored on this device, so another browser may show a different list.",
        "Unread updates tracks document revisions. Opening the current version updates its read record; it does not measure whether you finished reading. A later synced revision can become unread again.",
        "Create personal notes with New note. Drafts are different from saved articles and are excluded from article counts and export. Use available article actions for archives, restore and revision history.",
      ]),
      section("insights","Understand Home and Insights",[
        "Home summarizes articles, synced folders, favorites and unread updates. Click a number for its list, or View all insights for detailed analysis.",
        "Insights shows current knowledge composition, unread updates, source distribution (with how many documents in each folder you have opened) and sync status. The 7 days / 30 days selector affects reading activity and recent changes only, not a historical snapshot of the whole page.",
        "Added, updated and archived each count distinct documents in the period. One article can appear in multiple categories; their sum is not your total article count. Active totals exclude drafts and archived content.",
        "Unread counts require recorded changes on the current synced revision. Missing legacy history is explained rather than invented. Refresh retrieves current statistics; Updated is the query time, while Last synced is the source's successful sync time.",
      ]),
      section("sharing-export","Share, export and workspace scope",[
        "My Space is personal. Once you create an article share link, anyone holding it can read without signing in and see subsequent article changes. Verify that the content is suitable for link holders.",
        "Manage expiry and revoke links in the article's Share link dialog. Shares helps review sharing status. Revoked links can no longer open the document.",
        "Home's more-actions menu offers Export Markdown ZIP. It includes saved and archived notes, excluding drafts, revision history and attachments. It is not a full system backup.",
        "Team availability depends on deployment settings, roles and workspace state. Personal Home, Insights and these personal flows do not imply access for Team members. Follow read-only or access-denied messages.",
      ]),
    ],
  };
}
