import {applicationServices} from "./composition";
import type {CallerContext} from "@/modules/identity/domain/caller-context";
import {DomainError} from "@/shared/domain/errors";
export async function personalProfileRequest<T>(read:(services:ReturnType<typeof applicationServices>,caller:CallerContext)=>Promise<T>):Promise<T|null>{
  const services=applicationServices();const {caller}=await services.establishTrustedCaller();
  try{return await read(services,caller);}catch(error){if(error instanceof DomainError && ["WORKSPACE_NOT_FOUND","WORKSPACE_ACCESS_DENIED","INVALID_REQUEST"].includes(error.code))return null;throw error;}
}
