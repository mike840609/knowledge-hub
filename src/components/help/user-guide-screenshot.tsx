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
import syncDark from "./screens/sync-dark.png";
import syncLight from "./screens/sync-light.png";

type Shot={page:string;light:StaticImageData;dark:StaticImageData;en:string;zh:string};

// Regenerate with `make guide-screenshots` after the pictured screens change.
const SHOTS:Record<string,Shot[]>={
  "quick-start":[
    {page:"Import folder",light:importLight,dark:importDark,en:"Import folder: Choose folder picks the complete wiki root, or try a sample wiki first.",zh:"Import folder 頁：按 Choose folder 選完整 wiki 根目錄，或先試範例 wiki。"},
    {page:"Import preview",light:previewLight,dark:previewDark,en:"Import preview: check the summary and warnings, then Apply changes.",zh:"Import preview 頁：確認摘要與警告，再按 Apply changes。"},
  ],
  sync:[{page:"Source",light:syncLight,dark:syncDark,en:"Source page: Update from folder, top right. If this browser remembers the folder, Check for changes appears beside it.",zh:"來源頁右上角的 Update from folder；若這個瀏覽器記得該資料夾，旁邊會多一個 Check for changes。"}],
  reading:[{page:"Knowledge",light:readingLight,dark:readingDark,en:"Find the article in the tree on the left; synced articles are read only.",zh:"左側文件樹找文章，右側閱讀；資料夾同步的文章為唯讀。"}],
  insights:[{page:"Insights",light:insightsLight,dark:insightsDark,en:"Insights: switch the period with 7 days / 30 days, top right.",zh:"Insights 頁：右上角切換 7 days／30 days。"}],
  "sharing-export":[{page:"Share link",light:shareLight,dark:shareDark,en:"Share link: set a label and expiry, Create link, then Copy link.",zh:"Share link 對話框：設定標籤與期限，Create link 後按 Copy link。"}],
};

/** Real screens from the sample wiki, one image per theme; the outlined control is the one to use. */
export function UserGuideScreenshots({sectionId,locale}:{sectionId:string;locale:GuideLocale}) {
  const zh=locale==="zh-TW";
  return (SHOTS[sectionId]??[]).map(shot=>{
    const caption=zh?shot.zh:shot.en;
    // Framed as a window, so the pictured controls do not read as this page's own.
    return <figure key={shot.light.src} className="my-4">
      <div className="overflow-hidden rounded-md border border-kh-border bg-kh-bg shadow-popover">
        <div aria-hidden="true" className="relative flex h-8 items-center border-b border-kh-border bg-kh-bg-raised px-3">
          <span className="flex gap-2">{[0,1,2].map(i=><span key={i} className="size-3 rounded-full bg-kh-border"/>)}</span>
          <span className="absolute inset-x-16 truncate text-center text-body-sm text-kh-text-muted">{shot.page}</span>
        </div>
        <Image src={shot.light} alt={caption} sizes="(min-width: 768px) 720px, 100vw" className="h-auto w-full [[data-theme=dark]_&]:hidden"/>
        <Image src={shot.dark} alt={caption} sizes="(min-width: 768px) 720px, 100vw" className="hidden h-auto w-full [[data-theme=dark]_&]:block"/>
      </div>
      <figcaption className="mt-2 text-body-sm text-kh-text-secondary"><span className="font-medium text-kh-text">{zh?"畫面":"Screen"}</span> · {caption}</figcaption>
    </figure>;
  });
}
