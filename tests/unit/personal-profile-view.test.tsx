import {expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {PersonalProfileView} from "@/components/personal/personal-profile-view";
import type {PersonalProfile} from "@/modules/personal/domain/personal-profile";
vi.mock("@/components/shell/user-menu",()=>({UserMenu:()=> <button>Preferences</button>}));
vi.mock("@/components/personal/profile-refresh",()=>({ProfileRefresh:()=> <button>Refresh statistics</button>}));
const profile:PersonalProfile={reading:{articles:0,activeDays:0,trackedSince:null,daily:[]},workspaceId:"ws",identityName:"Mike Chen",days:7,since:"2026-09-27T14:32:00Z",generatedAt:"2026-10-04T14:32:00Z",counts:{articles:128,synced:110,notes:18,archived:9,folders:6,favorites:18,unread:12,browsed:24,syncedBrowsed:20},changes:{added:8,updated:23,archived:2},sync:{successful:5,failed:1,neverSynced:0,pending:2},sources:[{sourceId:"work",name:"Work Wiki",articles:48,viewed:12,lastSyncedAt:"2026-10-04T10:00:00Z"},{sourceId:"engineering",name:"Engineering notes",articles:32,viewed:0,lastSyncedAt:null},{sourceId:"reading",name:"Reading notes",articles:12,viewed:3,lastSyncedAt:null}],legacyChangesUnavailable:false};
it("renders analysis without duplicating Home identity and counters and matching drilldown/period links",()=>{
 const html=renderToStaticMarkup(<PersonalProfileView profile={profile}/>);
 expect(html).not.toContain("Mike Chen");expect(html).toContain(">Insights</h1>");expect(html).not.toContain("Knowledge overview");expect(html).toContain("Where your knowledge lives");expect(html).toContain("Recent changes");expect(html).toContain("Sync overview");expect(html).not.toContain("Continue reading");
 expect(html).toContain('/w/ws/profile/articles?filter=synced');expect(html).toContain('/w/ws/profile/sync?filter=pending');expect(html).toContain('/w/ws/profile?days=30');expect(html).toContain("3 other folders");expect(html).toContain("My Space only");expect(html).toContain("How counts work");
});
it("renders useful empty states and explains incomplete legacy history",()=>{
 const html=renderToStaticMarkup(<PersonalProfileView profile={{...profile,counts:{articles:0,synced:0,notes:0,archived:0,folders:0,favorites:0,unread:0,browsed:0,syncedBrowsed:0},sources:[],legacyChangesUnavailable:true}}/>);
 expect(html).toContain("Review pending previews");expect(html).toContain("Older syncs");expect(html).not.toContain("NaN");expect(html).not.toContain("Infinity");
});
it("shows unread updates and how much of each folder has been viewed",()=>{
 const html=renderToStaticMarkup(<PersonalProfileView profile={profile}/>);
 expect(html).toMatch(/href="\/w\/ws\/profile\/articles\?filter=unread&amp;days=7"><span>Unread updates<\/span><strong>12<\/strong>/);
 expect(html).toContain("12 of 48 viewed");expect(html).toContain("0 of 32 viewed");expect(html).toContain("3 of 12 viewed");
 // 110 synced − 92 listed = 18 documents elsewhere; 20 viewed − 15 listed = 5.
 expect(html).toContain("5 of 18 viewed");
 expect(html).toContain("width:25%");expect(html).toContain("24<span> of 128 documents, all time</span>");
});
it("draws no viewed share for a folder without documents",()=>{
 const html=renderToStaticMarkup(<PersonalProfileView profile={{...profile,counts:{...profile.counts,synced:0,folders:1,syncedBrowsed:0},sources:[{sourceId:"empty",name:"Empty",articles:0,viewed:0,lastSyncedAt:null}]}}/>);
 expect(html).toContain("0 documents");expect(html).not.toContain("NaN");expect(html).not.toContain("of 0 viewed");
});
