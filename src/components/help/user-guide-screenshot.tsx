import Image,{type StaticImageData} from "next/image";
import type {GuideLocale} from "@/components/imports/import-guide-content";
import importDark from "./screens/import-dark.png";
import importLight from "./screens/import-light.png";
import insightsDark from "./screens/insights-dark.png";
import insightsLight from "./screens/insights-light.png";
import previewDark from "./screens/preview-dark.png";
import previewLight from "./screens/preview-light.png";
import readingDark from "./screens/reading-dark.png";
import readingLight from "./screens/reading-light.png";
import shareDark from "./screens/share-dark.png";
import shareLight from "./screens/share-light.png";
import sourcesDark from "./screens/sources-dark.png";
import sourcesLight from "./screens/sources-light.png";
import syncDark from "./screens/sync-dark.png";
import syncLight from "./screens/sync-light.png";

type Shot={light:StaticImageData;dark:StaticImageData;path:[en:string,zh:string];en:string;zh:string;marks?:[en:string,zh:string][]};

// Regenerate with `make guide-screenshots` after the pictured screens change. Each ①② in a caption
// is the numbered mark the capture places, in the same order (tests/e2e/user-guide-screenshots.spec.ts).
const SHOTS:Record<string,Shot[]>={
  "quick-start":[
    {light:importLight,dark:importDark,path:["Sources › Import folder","Sources › Import folder"],en:"① Choose folder and pick the complete wiki root, or try a sample wiki below first.",zh:"① 按 Choose folder 選完整 wiki 根目錄；也可以先試下方的範例 wiki。"},
    {light:previewLight,dark:previewDark,path:["Sources › Import preview","Sources › Import preview"],en:"① Review warnings and blockers, ② then Apply changes.",zh:"① 先看警告與阻擋問題，② 確認後按 Apply changes。"},
  ],
  sync:[
    {light:sourcesLight,dark:sourcesDark,path:["My Space › Sources","My Space › Sources"],en:"The icon at the start of each row tells you how that source updates.",zh:"Sources 列表每一列最左邊的圖示，說明這個來源怎麼更新。",marks:[
      ["① Hub (Notes): notes written on this site. Edit them here; there is no folder to sync.","① Hub（Notes）：在網站上寫的筆記，直接在這裡編輯，沒有資料夾要同步。"],
      ["② Sync icon (Check for changes): this browser remembers the folder. One click scans it again, then Apply in the preview.","② 同步圖示（Check for changes）：這個瀏覽器記得資料夾，之後點一下就重新掃描，再到預覽按 Apply。"],
      ["③ Folder icon (Update from folder): this browser does not remember the folder (first time, another browser, or permission expired). Pick the complete root again; after a successful Apply it becomes ②. Needs a browser that can pick folders, such as Chrome or Edge.","③ 資料夾圖示（Update from folder）：這個瀏覽器沒記住資料夾（第一次、換瀏覽器或授權失效），要重新選完整根目錄；Apply 成功後就會變成 ②。需使用能選取資料夾的瀏覽器，例如 Chrome、Edge。"],
    ]},
    {light:syncLight,dark:syncDark,path:["Sources › your source","Sources › 你的來源"],en:"① Update from folder picks the folder again. If this browser remembers the folder, Check for changes appears beside it.",zh:"① 按 Update from folder 重新選資料夾；若這個瀏覽器記得該資料夾，旁邊會多一個 Check for changes。"}],
  reading:[{light:readingLight,dark:readingDark,path:["Knowledge › article","Knowledge › 文章"],en:"① Pick an article in the tree, ② read it on the right; synced articles are read only.",zh:"① 在左側文件樹選文章，② 右側閱讀；資料夾同步的文章為唯讀。"}],
  insights:[{light:insightsLight,dark:insightsDark,path:["Insights","Insights"],en:"① 7 days / 30 days changes only reading activity and recent changes.",zh:"① 切換 7 days／30 days，只影響閱讀活動與近期變更。"}],
  "sharing-export":[{light:shareLight,dark:shareDark,path:["Knowledge › article › Share link","Knowledge › 文章 › Share link"],en:"① Set a label and expiry, then Create link; ② Copy link.",zh:"① 設定標籤與期限後按 Create link，② 按 Copy link 複製連結。"}],
};

/** Real screens from the sample wiki, one image per theme; the numbered, outlined controls are the ones to use. */
export function UserGuideScreenshots({sectionId,locale}:{sectionId:string;locale:GuideLocale}) {
  const zh=locale==="zh-TW";
  return (SHOTS[sectionId]??[]).map(shot=>{
    const caption=zh?shot.zh:shot.en;
    // Framed as a window, so the pictured controls do not read as this page's own.
    return <figure key={shot.light.src} className="my-4">
      <a href={shot.light.src} target="_blank" rel="noreferrer" title={zh?"開啟完整尺寸":"Open full size"} className="kh-focus-ring block rounded-md">
        <div className="overflow-hidden rounded-md border border-kh-border bg-kh-bg">
          <div aria-hidden="true" className="relative flex h-8 items-center border-b border-kh-border bg-kh-bg-raised px-3">
            <span className="flex gap-2">{[0,1,2].map(i=><span key={i} className="size-3 rounded-full bg-kh-border"/>)}</span>
            <span className="absolute inset-x-16 truncate text-center text-body-sm text-kh-text-muted">{shot.path[zh?1:0]}</span>
          </div>
          <Image src={shot.light} alt={caption} sizes="(min-width: 768px) 720px, 100vw" className="h-auto w-full [[data-theme=dark]_&]:hidden"/>
          <Image src={shot.dark} alt={caption} sizes="(min-width: 768px) 720px, 100vw" className="hidden h-auto w-full [[data-theme=dark]_&]:block"/>
        </div>
      </a>
      <figcaption className="mt-2 text-body-sm text-kh-text-secondary"><span className="font-medium text-kh-text">{zh?"畫面":"Screen"}</span> · {caption}
        <a href={shot.light.src} target="_blank" rel="noreferrer" className="kh-focus-ring mt-1 inline-block rounded-md text-caption text-kh-link underline underline-offset-2">{zh?"開啟完整尺寸":"Open full size"}</a>
        {shot.marks?<ul className="mt-2 space-y-1">{shot.marks.map(mark=><li key={mark[0]}>{zh?mark[1]:mark[0]}</li>)}</ul>:null}
      </figcaption>
    </figure>;
  });
}
