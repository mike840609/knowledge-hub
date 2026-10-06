import Link from "next/link";
import {ArrowRight} from "lucide-react";
import type {ProfileCounts} from "@/modules/personal/domain/personal-profile";
import styles from "./profile.module.css";

export function PersonalStatsSummary({workspaceId,counts}:{workspaceId:string;counts:ProfileCounts}) {
  const base=`/w/${workspaceId}/profile`;
  const stats=[
    {name:"Knowledge documents",count:counts.articles,href:`${base}/articles?filter=all`},
    {name:"Synced folders",count:counts.folders,href:`${base}/sync?filter=folders`},
    {name:"Favorites",count:counts.favorites,href:`${base}/articles?filter=favorites`},
    {name:"Unread updates",count:counts.unread,href:`${base}/articles?filter=unread`},
  ];
  return <section aria-label="Personal statistics" className={`${styles.summary} px-3`}>
    <div className={styles.summaryStats}>
      {stats.map(stat=><Link key={stat.name} href={stat.href} className={`${styles.summaryStat} kh-focus-ring`} aria-label={`${stat.name}: ${stat.count}`}>
        <span className={styles.summaryValue}>{stat.count.toLocaleString("en-US")}</span>
        <span className={styles.summaryLabel}>{stat.name}<ArrowRight size={13} className={styles.arrow} aria-hidden="true"/></span>
      </Link>)}
    </div>
    <Link href={base} className="kh-focus-ring inline-flex items-center gap-1 rounded text-caption text-kh-link">View all insights<ArrowRight size={12} aria-hidden="true"/></Link>
  </section>;
}
