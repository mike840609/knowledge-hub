import type {PersonalProfileStats,ProfileDocument,ProfileDocumentFilter,ProfilePage,ProfileSyncFilter,ProfileSyncItem} from "../domain/personal-profile";
export type ProfileScope = {userId:string;workspaceId:string;since:Date;now:Date};
export interface PersonalProfileRepository {
  overview(scope:ProfileScope):Promise<PersonalProfileStats>;
  documents(scope:ProfileScope,filter:ProfileDocumentFilter,after?:string):Promise<ProfilePage<ProfileDocument>>;
  syncItems(scope:ProfileScope,filter:ProfileSyncFilter,after?:string):Promise<ProfilePage<ProfileSyncItem>>;
}
