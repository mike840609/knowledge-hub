import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbDocumentReviewWriteLedger } from "@/infrastructure/database/mariadb/repositories/document-review-write-ledger";
export type ReviewCleanupOptions={apply?:boolean;olderThanHours?:number;batchSize?:number;now?:Date};
/** Privileged operator cleanup, never called from review requests. Defaults to dry run. */
export async function cleanupDocumentReviewWriteEvents(pool:Pool,options:ReviewCleanupOptions={}):Promise<number> {
 const {apply=false,olderThanHours=48,batchSize=1000,now=new Date()}=options;
 if(!Number.isFinite(olderThanHours)||olderThanHours<48)throw new Error("Retention must be at least 48 hours.");
 if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>1000)throw new Error("Batch size must be 1–1,000.");
 const connection=await pool.getConnection(),before=new Date(now.getTime()-olderThanHours*3600_000);
 try{
  const ledger=new MariaDbDocumentReviewWriteLedger(connection);
  if(!apply)return await ledger.countOlderThan(before);
  let deleted=0,count=0;
  do{count=await ledger.deleteOlderThan(before,batchSize);deleted+=count;}while(count===batchSize);
  return deleted;
 }finally{connection.release();}
}
async function main(){
 const args=process.argv.slice(2);
 if(args.includes("--help")){console.log("Usage: tsx scripts/admin/cleanup-document-review-write-events.ts [--target=dev|test|e2e] [--apply] [--older-than-hours=48] [--batch-size=1000] (default: dry-run)");return;}
 const flag=(name:string,fallback:string)=>args.find(a=>a.startsWith(`${name}=`))?.slice(name.length+1)??fallback;
 const target=flag("--target","dev");
 if(target!=="dev"&&target!=="test"&&target!=="e2e")throw new Error("Expected --target=dev|test|e2e.");
 const apply=args.includes("--apply"),pool=createDatabasePool(databaseConfig(target));
 try{const count=await cleanupDocumentReviewWriteEvents(pool,{apply,olderThanHours:Number(flag("--older-than-hours","48")),batchSize:Number(flag("--batch-size","1000"))});console.log(`${apply?"Deleted":"Dry-run: would delete"} ${count} expired review write events.`);}finally{await pool.end();}
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(()=>{console.error("Review write event cleanup failed.");process.exitCode=1;});
