import {expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {PersonalProfileView} from "@/components/personal/personal-profile-view";
import type {PersonalProfile} from "@/modules/personal/domain/personal-profile";
vi.mock("@/components/shell/user-menu",()=>({UserMenu:()=> <button>Preferences</button>}));
vi.mock("@/components/personal/profile-refresh",()=>({ProfileRefresh:()=> <button>Refresh statistics</button>}));
const profile:PersonalProfile={workspaceId:"ws",identityName:"Mike Chen",days:7,since:"2026-09-27T14:32:00Z",generatedAt:"2026-10-04T14:32:00Z",counts:{articles:128,synced:110,notes:18,archived:9,folders:6,favorites:18,unread:12},changes:{added:8,updated:23,archived:2},sync:{successful:5,failed:1,neverSynced:0,pending:2},sources:[{sourceId:"work",name:"Work Wiki",articles:48,lastSyncedAt:"2026-10-04T10:00:00Z"},{sourceId:"engineering",name:"Engineering notes",articles:32,lastSyncedAt:null},{sourceId:"reading",name:"Reading notes",articles:12,lastSyncedAt:null}],legacyChangesUnavailable:false};
it("renders analysis without duplicating Home identity and counters and matching drilldown/period links",()=>{
 const html=renderToStaticMarkup(<PersonalProfileView profile={profile}/>);
 expect(html).not.toContain("Mike Chen");expect(html).toContain(">Insights</h1>");expect(html).not.toContain("Knowledge overview");expect(html).toContain("Where your knowledge lives");expect(html).toContain("Recent changes");expect(html).toContain("Sync overview");expect(html).not.toContain("Continue reading");
 expect(html).toContain('/w/ws/profile/articles?filter=synced');expect(html).toContain('/w/ws/profile/sync?filter=pending');expect(html).toContain('/w/ws/profile?days=30');expect(html).toContain("3 other folders");expect(html).toContain("My Space only");expect(html).toContain("How counts work");
});
it("renders useful empty states and explains incomplete legacy history",()=>{
 const html=renderToStaticMarkup(<PersonalProfileView profile={{...profile,counts:{articles:0,synced:0,notes:0,archived:0,folders:0,favorites:0,unread:0},sources:[],legacyChangesUnavailable:true}}/>);
 expect(html).toContain("Import your first folder");expect(html).toContain("Older syncs");expect(html).not.toContain("NaN");expect(html).not.toContain("Infinity");
});
