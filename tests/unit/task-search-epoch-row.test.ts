import {describe,expect,it} from "vitest";
import {MariaDbTaskExportStore} from "@/infrastructure/database/mariadb/repositories/task-knowledge";
import {parseTaskSearchQuery} from "@/modules/task-knowledge/domain/task-search-query";
import type {QueryConnection} from "@/infrastructure/database/mariadb/repositories/shared";

const workspaceId="019a1e18-7a00-7000-8000-0a0000000002";
const id="019a1e18-7a00-7000-8000-0a0000000001";
describe("task search SQL result timestamp representation",()=>{
  it("maps a statement timeout to a non-leaking retryable domain error", async()=>{
    const connection={query:async()=>{throw {errno:1969,message:"SQL statement timed out; private SQL query"};}} as unknown as QueryConnection;
    await expect(new MariaDbTaskExportStore(connection).searchTasks(
      workspaceId,workspaceId,parseTaskSearchQuery({}),null,51,
    )).rejects.toMatchObject({code:"TASK_SEARCH_UNAVAILABLE",message:"Task search timed out. Try again or narrow the filters."});
  });

  it("accepts valid pre-1970 signed BIGINT milliseconds", async()=>{
    const epoch = Date.parse("0001-01-01T00:00:00Z");
    const connection={
      query:async()=>[{
        task_result_id:id,lifecycle:"ACTIVE",latest_revision_no:1,
        binding_label:"laptop",binding_status:"ACTIVE",completed_at_epoch_ms:String(epoch),
        agent:"opencode",verification_status:"passed",title:"Old",summary:"Early",search_body:"Early",
      }],
    } as unknown as QueryConnection;
    const row=(await new MariaDbTaskExportStore(connection).searchTasks(
      workspaceId,workspaceId,parseTaskSearchQuery({}),null,51,
    ))[0];
    expect(row.completedAtEpochMs).toBe(epoch);
  });
});
