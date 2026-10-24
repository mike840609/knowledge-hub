import { NextResponse } from "next/server";
import { getDatabasePool } from "@/server/composition";
import { pingDatabase } from "@/server/database-health";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * A cold Layerbase database wakes on the first connection. This route is the
 * cheapest way to wake it and the only endpoint an uptime check should use;
 * it deliberately says nothing about the failure beyond "not ok".
 */
export async function GET() {
  try {
    await pingDatabase(getDatabasePool());
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error("[health] database ping failed:", error instanceof Error ? (error as { code?: string }).code ?? error.message : "unknown");
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}
