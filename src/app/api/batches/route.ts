// POST /api/batches (arch §7): create a batch from {urls: string[]}.
// All-or-nothing validation (A-UX5): any invalid line -> 400, nothing processed.
// 400 on empty / >50; 429 when 3 batches are already live (backpressure, arch §5).

import { NextResponse } from "next/server";
import { ensureBooted } from "@/lib/boot";
import { getConfig } from "@/lib/config";
import { validateBatch, OVER_LIMIT_MESSAGE } from "@/lib/validation";
import { createBatch, liveBatchCount, toPublicBatch } from "@/lib/registry";
import { enqueueBatch } from "@/lib/pipeline";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Next.js route files may only export route fields — message lives here as a module constant.
const SERVER_BUSY_MESSAGE = "Server busy — try again in a few minutes";

export async function POST(req: Request): Promise<NextResponse> {
  ensureBooted();
  const cfg = getConfig();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const urls = (body as { urls?: unknown })?.urls;
  if (!Array.isArray(urls) || !urls.every((u) => typeof u === "string")) {
    return NextResponse.json({ error: "Body must be { urls: string[] }" }, { status: 400 });
  }

  const validation = validateBatch(urls, cfg.maxUrlsPerBatch);
  if (!validation.ok) {
    if (validation.code === "over_limit") {
      return NextResponse.json({ error: OVER_LIMIT_MESSAGE, code: "over_limit" }, { status: 400 });
    }
    if (validation.code === "empty") {
      return NextResponse.json({ error: "No URLs submitted", code: "empty" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "One or more lines are not supported post URLs", code: "invalid_lines", errors: validation.errors },
      { status: 400 },
    );
  }

  if (liveBatchCount() >= cfg.maxLiveBatches) {
    return NextResponse.json({ error: SERVER_BUSY_MESSAGE, code: "busy" }, { status: 429 });
  }

  const batch = createBatch(validation.items, validation.duplicatesRemoved);
  log("info", "batch_created", {
    batchId: batch.id,
    items: batch.items.length,
    duplicatesRemoved: batch.duplicatesRemoved,
  });

  // Snapshot the response BEFORE enqueueing: the pool starts work synchronously, and the 202
  // describes the accepted submission (everything "queued"), not a race with the first step.
  const pub = toPublicBatch(batch);
  const responseBody = {
    batchId: batch.id,
    items: pub.items.map((i) => ({
      id: i.id,
      url: i.url,
      platform: i.platform,
      status: i.status,
      duplicateRemoved: i.duplicateRemoved ?? false,
    })),
    rejected: pub.rejected,
    duplicatesRemoved: pub.duplicatesRemoved,
  };
  enqueueBatch(batch);

  return NextResponse.json(responseBody, { status: 202 });
}
