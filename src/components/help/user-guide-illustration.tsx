import {ArrowDown, ArrowRight, Check, FileText, Folder, MessageSquare, Search, Star} from "lucide-react";
import type {ReactNode} from "react";
import type {GuideLocale} from "@/components/imports/import-guide-content";

const icon = "size-4 shrink-0 text-kh-text-muted";
const label = "text-body-sm font-medium text-kh-text";

function Flow({steps}:{steps:{title:string;detail:string}[]}) {
  return <ol className="flex flex-col gap-3 sm:flex-row sm:items-start">{steps.map((step,i)=><li key={step.title} className="flex min-w-0 flex-1 items-start gap-2">
    {i>0?<><ArrowRight aria-hidden="true" className={`${icon} mt-1 hidden sm:block`}/><ArrowDown aria-hidden="true" className={`${icon} mt-1 sm:hidden`}/></>:null}
    <div className="min-w-0"><p className={label}><span className="mr-1.5 text-kh-text-muted">{i+1}.</span>{step.title}</p><p className="mt-1 text-body-sm text-kh-text-secondary">{step.detail}</p></div>
  </li>)}</ol>;
}

function Figure({id,title,note,children}:{id:string;title:string;note:string;children:ReactNode}) {
  const simple=["troubleshooting","reading","insights"].includes(id);
  return <figure aria-labelledby={`${id}-figure-caption`} className={simple?"my-4 border-y border-kh-border":"my-4 overflow-hidden rounded-md border border-kh-border"}>
    <figcaption id={`${id}-figure-caption`} className={`${simple?"pt-3":"border-b border-kh-border bg-kh-bg-subtle px-4 py-2"} text-body-sm font-medium text-kh-text`}>{title}</figcaption>
    <div className={`space-y-4 ${simple?"py-4":"p-4"}`}>{children}</div>
    <p className={`${simple?"pb-3":"border-t border-kh-border px-4 py-2"} text-body-sm text-kh-text-secondary`}>{note}</p>
  </figure>;
}

/** Live text diagrams: readable in both themes, with no inert button lookalikes. */
export function UserGuideIllustration({sectionId,locale}:{sectionId:string;locale:GuideLocale}) {
  const zh=locale==="zh-TW";
  const t=(en:string,tw:string)=>zh?tw:en;
  switch(sectionId) {
    case "quick-start": return <Figure id={sectionId} title={t("Diagram · From folder to readable articles","示意圖 · 從資料夾到可閱讀的文章")} note={t("Choose the complete wiki root again for future updates. Previewing does not change your articles.","之後更新仍選完整 wiki 根目錄。預覽不會改動已匯入的文章。") }>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-kh-border pb-4">
        <div className="font-mono text-body-sm"><p className="flex items-center gap-2 font-semibold"><Folder className={icon} aria-hidden="true"/>wiki/ <span className="font-sans text-kh-text-secondary">{t("← Choose this folder","← 選這個資料夾")}</span></p><p className="ml-6 mt-1">├ notes/</p><p className="ml-6">└ guide.md</p></div>
        <p className="max-w-panel text-body-sm text-kh-text-secondary">{t("Keep the root intact: choosing only notes/ can make other imported articles appear missing.","保留完整根目錄：只選 notes/，可能讓其他已匯入文章被判定為消失。")}</p>
      </div>
      <Flow steps={[{title:"Choose folder",detail:t("Select wiki/","選取 wiki/")},{title:"Import preview",detail:t("Review changes and blockers","檢查變更與阻擋問題")},{title:"Apply changes",detail:t("Apply, then open an article","成功套用後開啟文章")}]}/>
    </Figure>;
    case "sync": return <Figure id={sectionId} title={t("Diagram · Each update needs an Apply","示意圖 · 每次更新都需要 Apply")} note={t("Awaiting Apply = pending changes. Last synced = the last successful Apply.","Awaiting Apply＝變更待套用；Last synced＝上次成功套用時間。") }>
      <Flow steps={[{title:t("Edit locally","修改本機文件"),detail:t("Use the original root folder","使用原本的完整根目錄")},{title:"Check for changes",detail:t("Scan and inspect the preview","掃描並檢查差異預覽")},{title:"Apply changes",detail:t("Only success updates the Hub","成功後才更新網站文章")}]}/>
      <p className="flex items-start gap-2 border-t border-kh-border pt-3 text-body-sm text-kh-text-secondary"><Check className={icon} aria-hidden="true"/>{t("Cancel before Apply: the previously applied articles stay as they were. There is no automatic background sync.","Apply 前取消：之前已套用的文章維持原樣。系統不會在背景自動同步。")}</p>
    </Figure>;
    case "troubleshooting": return <Figure id={sectionId} title={t("Diagram · Match the message to the next step","示意圖 · 從畫面訊息找到下一步")} note={t("If the Apply outcome is uncertain, inspect sync history first; do not create a duplicate source.","若無法確認 Apply 結果，先查同步歷史，不要再建立重複來源。") }>
      <dl className="divide-y divide-kh-border">{[
        [t("Folder permission expired","資料夾授權失效"),t("Existing source → Choose folder → same root","原有來源 → Choose folder → 同一個根目錄")],
        [t("Preview expired / source changed","預覽過期／來源已變更"),t("Fresh preview → review differences → Apply","重新建立預覽 → 檢查差異 → Apply")],
        [t("Many articles marked archived","大量文章被列為封存"),t("Check root and exclusions before Apply","先確認根目錄與排除規則，再決定 Apply")],
      ].map(([problem,action])=><div key={problem} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-2 sm:gap-4"><dt className={label}>{problem}</dt><dd className="text-body-sm text-kh-text-secondary">{action}</dd></div>)}</dl>
    </Figure>;
    case "reading": return <Figure id={sectionId} title={t("Diagram · Find an article, then keep your place","示意圖 · 找文章，再整理閱讀進度")} note={t("Favorites are saved to your account. Recently opened is stored on this device.","收藏保存在帳號；最近開啟保存在目前裝置。") }>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div className="space-y-2 border-b border-kh-border pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4"><p className={label}>Home</p>{[[Search,"Search"],[FileText,"Knowledge"],[Folder,"Sources"]].map(([Icon,name])=>{const Glyph=Icon as typeof Search;return <p key={String(name)} className="flex items-center gap-2 text-body-sm text-kh-text-secondary"><Glyph className={icon} aria-hidden="true"/>{String(name)}</p>;})}</div>
        <div className="space-y-3"><p className="flex items-center gap-2 text-body font-medium"><FileText className={icon} aria-hidden="true"/>{t("Article title","文章標題")}</p><p className="font-mono text-body-sm text-kh-text-muted">wiki / notes / guide.md</p><div className="border-t border-kh-border pt-3 text-body-sm text-kh-text-secondary"><p className="flex items-center gap-2"><Star className={icon} aria-hidden="true"/>{t("Star → Favorites","星號 → Favorites 收藏")}</p><p className="mt-2">{t("Open current revision → update the read record","開啟目前版本 → 更新閱讀紀錄")}</p></div></div>
      </div>
    </Figure>;
    case "insights": return <Figure id={sectionId} title={t("Diagram · What the time selector changes","示意圖 · 時間範圍影響哪些數字")} note={t("An article can be both added and updated in the selected period. Do not add those counts to get your article total.","同一篇文章可能在期間內新增又更新；分類數字相加不等於文章總數。") }>
      <div className="grid gap-4 sm:grid-cols-2"><div><p className={label}>{t("Current state","目前狀態")}</p><ul className="mt-2 space-y-1 text-body-sm text-kh-text-secondary"><li>{t("Active articles and source distribution","活躍文章與來源分布")}</li><li>{t("Unread updates and sync status","未讀更新與同步狀態")}</li></ul></div><div className="border-t border-kh-border pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"><p className={label}>7 days / 30 days</p><ArrowDown className={`${icon} my-2`} aria-hidden="true"/><p className="text-body-sm text-kh-text-secondary">{t("Reading activity + recent changes","閱讀活動＋近期變更")}</p><p className="mt-1 text-body-sm text-kh-text-muted">{t("Only these use the selected period","只有這兩項使用所選期間")}</p></div></div>
    </Figure>;
    case "sharing-export": return <Figure id={sectionId} title={t("Diagram · Read, discuss and save a shared article","示意圖 · 閱讀、留言與儲存分享")} note={t("Save share retains the link, not an article copy. Expiry and revocation still apply; it grants no workspace access.","Save share 只保存連結，不複製文章；仍受期限與撤銷限制，也不會取得對方的工作區權限。") }>
      <Flow steps={[{title:"Share link",detail:t("Owner sets expiry or revokes","擁有者設定期限或撤銷")},{title:t("Open link","開啟連結"),detail:t("Read article and visible comments","免登入讀文章與公開留言")},{title:t("Sign in","登入"),detail:t("Comment, reply or Save share","新增留言、回覆或 Save share")}]}/>
      <div className="grid gap-4 border-t border-kh-border pt-4 sm:grid-cols-[2fr_1fr]"><div><p className={label}>{t("Shared article","分享的文章")}</p><p className="mt-2 rounded-sm bg-kh-bg-selected px-2 py-1 text-body-sm">{t("Select a passage → Comment","選取一段文字 → Comment")}</p><p className="mt-2 text-body-sm text-kh-text-secondary">{t("Passage count → its discussion","段落旁留言數 → 對應討論")}</p></div><div className="border-t border-kh-border pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"><p className="flex items-center gap-2 text-body-sm font-medium"><MessageSquare className={icon} aria-hidden="true"/>Comments</p><p className="mt-2 text-body-sm text-kh-text-secondary">{t("Opens a side panel on desktop; a drawer on smaller screens.","桌面開啟右側欄；小螢幕開啟抽屜。")}</p></div></div>
    </Figure>;
    default:return null;
  }
}
