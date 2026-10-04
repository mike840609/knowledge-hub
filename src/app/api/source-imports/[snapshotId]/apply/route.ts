import { NextRequest, NextResponse } from "next/server";
import { toImportErrorResponse } from "@/server/http-error-response";
import { importError } from "@/modules/sources/domain/import-errors";
import { applySourceImport } from "@/server/source-imports";

export async function POST(request: NextRequest, context: { params: Promise<{ snapshotId: string }> }) {
  try {
    const { snapshotId } = await context.params;
    const raw=await request.text();
    let acknowledgment: {planHash:string;sourceName:string}|undefined;
    if(raw){
      let body:unknown;try{body=JSON.parse(raw);}catch{throw importError("INVALID_IMPORT_MANIFEST","Provide a valid confirmation.");}
      if(!body||typeof body!=="object"||Array.isArray(body))throw importError("INVALID_IMPORT_MANIFEST","Provide a valid confirmation.");
      const candidate=(body as {riskAcknowledgment?:unknown}).riskAcknowledgment;
      if(candidate!==undefined){
        if(!candidate||typeof candidate!=="object"||!("planHash" in candidate)||!("sourceName" in candidate)||typeof candidate.planHash!=="string"||typeof candidate.sourceName!=="string")throw importError("INVALID_IMPORT_MANIFEST","Provide a valid confirmation.");
        acknowledgment={planHash:candidate.planHash,sourceName:candidate.sourceName};
      }
    }
    const result = acknowledgment ? await applySourceImport(snapshotId,acknowledgment) : await applySourceImport(snapshotId);
    if (result.kind === "VERSION_CONFLICT") {
      const mapped = toImportErrorResponse(
        importError("SOURCE_VERSION_CONFLICT", "The source changed after this preview was created.", {
          snapshotVersion: result.snapshotVersion,
          currentVersion: result.currentVersion,
        }),
      );
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    const mapped = toImportErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
