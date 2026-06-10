// GET /api/batches/:id — full batch state for polling. audioPath is never serialised.

import { NextResponse } from "next/server";
import { ensureBooted } from "@/lib/boot";
import { getBatch, toPublicBatch } from "@/lib/registry";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  ensureBooted();
  const { id } = await ctx.params;
  const batch = getBatch(id);
  if (!batch) {
    // Also the post-restart case: in-memory state is gone (accepted, RK-4).
    return NextResponse.json(
      { error: "This batch is no longer available — please resubmit" },
      { status: 404 },
    );
  }
  return NextResponse.json(toPublicBatch(batch));
}
