import { PageHeader } from "@/components/shell/page-header";
import Link from "next/link";
import {helpWorkspaceId} from "@/server/help-read";
import {GuideContentBlock} from "@/components/imports/import-guide";
import {UserGuideIllustration} from "@/components/help/user-guide-illustration";
import {UserGuideScreenshots} from "@/components/help/user-guide-screenshot";
import {UserGuideNavigation} from "@/components/help/user-guide-navigation";
import {userGuideContent,type UserGuideAction} from "@/components/help/user-guide-content";


function GuideActionLinks({links,base,locale}:{links:UserGuideAction[];base:string;locale:string}) {
  const destinations={sample:`${base}/sources/import#sample-wiki`,sources:`${base}/sources`,preview:`/help/import-guide?lang=${locale}#import-preview-apply`,identity:`/help/import-guide?lang=${locale}#keep-in-sync`};
  if(!links.length)return null;
  return <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-body">{links.map(action=><li key={action.target}><Link className="kh-focus-ring rounded-md text-kh-link underline underline-offset-4" href={destinations[action.target]}>{action.label}</Link></li>)}</ul>;
}

/**
 * The user guide, one address for everyone (`/help`): its words are the same for every reader, so
 * a link to it can be passed on. Only its links into the product lead to the reader's own My Space.
 */
export default async function UserGuidePage({searchParams}:{searchParams:Promise<{lang?:string}>}) {
  const workspaceId=await helpWorkspaceId(),{lang}=await searchParams;
  const locale=lang==="en"?"en":"zh-TW",zh=locale==="zh-TW",content=userGuideContent(locale),base=`/w/${workspaceId}`;
  const link="kh-focus-ring rounded-md text-kh-link underline-offset-4 hover:underline";
  return <main className="pb-6" lang={locale}>
    <div className="kh-page">
    <PageHeader location="Home" locationHref={`${base}/home`} title={content.title} actions={<nav aria-label={zh?"手冊語言":"Guide language"} className="flex gap-3">{[{lang:"en",label:"English"},{lang:"zh-TW",label:"繁體中文"}].map(l=><Link key={l.lang} lang={l.lang} className={link} href={`/help?lang=${l.lang}`} aria-current={locale===l.lang?"page":undefined}>{l.label}</Link>)}</nav>} />
    <p className="mt-2 text-body text-kh-text-muted">{content.intro}</p>
    <div className="mt-4 flex flex-wrap gap-4 text-body"><Link className={link} href={`${base}/sources/import`}>{zh?"開始匯入":"Import folder"}</Link><Link className={link} href={`/help/import-guide?lang=${locale}`}>{zh?"Markdown 格式、knowledge_id 與匯入限制":"Markdown format, knowledge_id and import limits"}</Link></div>
    </div>
    <div className="kh-page-wide mt-6 grid min-w-0 gap-6 xl:grid-cols-[176px_minmax(0,1fr)]">
      <aside className="min-w-0"><UserGuideNavigation sections={content.sections.map(({id,title})=>({id,title}))} locale={locale}/></aside>
      <div className="min-w-0 max-w-reading">{content.sections.map(s=><section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="mt-6 scroll-mt-6 border-t border-kh-border pt-6 first:mt-0 first:border-t-0 first:pt-0">
        <h2 id={`${s.id}-heading`} tabIndex={-1} className="kh-focus-ring rounded-md text-title font-semibold">{s.title}</h2>
        <UserGuideIllustration sectionId={s.id} locale={locale}/>
        <UserGuideScreenshots sectionId={s.id} locale={locale}/>
        <div className="[&_ul]:space-y-2">{s.body.map((block,i)=><GuideContentBlock key={i} block={block} caption={s.title}/>)}</div>
        <GuideActionLinks links={s.links} base={base} locale={locale}/>
        <div className="mt-4 space-y-3">{s.details.map(detail=><details key={detail.title}><summary className="kh-focus-ring cursor-pointer rounded-md text-body font-medium text-kh-text-secondary">{detail.title}</summary><GuideContentBlock block={{kind:"ul",items:detail.items}} caption={detail.title}/><GuideActionLinks links={detail.links??[]} base={base} locale={locale}/></details>)}</div>
      </section>)}</div>
    </div>
  </main>;
}
