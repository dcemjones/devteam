// POST /api/batches/:id/items/:itemId/retry (T-203, ST-04 transient failure).
// 202 re-enqueued from the failed step; 409 if the item is not in `failed`; 404 unknown.

import { NextResponse } from "next/server";
import { ensureBooted } from "@/lib/boot";
import { getBatch, findItem } from "@/lib/registry";
import { retryItem } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; itemId: string }> },
): Promise<NextResponse> {
  ensureBooted();
  const { id, itemId } = await ctx.params;

  const batch = getBatch(id);
  if (!batch) {
    return NextResponse.json(
      { error: "This batch is no longer available — please resubmit" },
      { status: 404 },
    );
  }
  const item = findItem(batch, itemId);
  if (!item) {
    return NextResponse.json({ error: "Unknown item" }, { status: 404 });
  }

  const outcome = await retryItem(batch, item);
  if (!outcome.ok) {
    return NextResponse.json({ error: "Item is not in a failed state" }, { status: 409 });
  }
  return NextResponse.json({ status: "queued", fromStep: outcome.fromStep }, { status: 202 });
}
