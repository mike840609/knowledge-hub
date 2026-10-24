import {notFound} from "next/navigation";
import {personalProfileRequest} from "@/server/personal-profile";
import {PersonalProfileView} from "@/components/personal/personal-profile-view";
import {identityProviderKind} from "@/server/config";
import {SignOutForm} from "@/components/auth/sign-out-form";
export const dynamic="force-dynamic";
export default async function ProfilePage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{days?:string}>}){
 const {workspaceId}=await params;const {days}=await searchParams;
 const profile=await personalProfileRequest((s,c)=>s.personalProfile.get(c,workspaceId,days));
 if(!profile)notFound();
 return <><PersonalProfileView profile={profile}/>{identityProviderKind()==="google"?<div className="kh-page pb-6"><SignOutForm/></div>:null}</>;
}
