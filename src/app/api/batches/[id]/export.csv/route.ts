// GET /api/batches/:id/export.csv (T-402, ST-03 export).
// Serves the batch's CURRENT state; the UI only enables the button once the batch settles
// ("Available when the batch finishes"), but the route itself never blocks — a CSV of a
// half-finished batch is still truthful (processing rows carry status "processing").

import { NextResponse } from "next/server";
import { ensureBooted } from "@/lib/boot";
import { getBatch } from "@/lib/registry";
import { batchToCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  ensureBooted();
  const { id } = await ctx.params;
  const batch = getBatch(id);
  if (!batch) {
    return NextResponse.json(
      { error: "This batch is no longer available — please resubmit" },
      { status: 404 },
    );
  }
  return new Response(batchToCsv(batch), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="transcripts.csv"',
      "Cache-Control": "no-store",
    },
  });
}
