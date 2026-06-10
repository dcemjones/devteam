// API routes in mock mode (T-104 + later route tickets). Route handlers are invoked directly
// with constructed Requests — no server process needed.

import { beforeEach, describe, expect, it } from "vitest";
import { setupMockEnv, waitForSettled, FIX } from "./helpers";
import { POST as postBatches } from "@/app/api/batches/route";
import { GET as getBatchRoute } from "@/app/api/batches/[id]/route";
import { GET as getHealth } from "@/app/api/health/route";

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  setupMockEnv();
});

describe("POST /api/batches", () => {
  it("accepts a single valid YouTube URL with 202 (ST-01 happy path)", async () => {
    const res = await postBatches(postReq({ urls: [FIX.ok(1)] }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.batchId).toBeTruthy();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].platform).toBe("youtube");
    expect(body.items[0].status).toBe("queued");
  });

  it("rejects invalid lines all-or-nothing with per-line errors (ST-01 invalid input)", async () => {
    const res = await postBatches(
      postReq({ urls: [FIX.ok(1), "https://example.com/watch?v=abc123"] }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_lines");
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].line).toBe(2);
    expect(body.errors[0].message).toBe(
      "Not a supported post URL — use Instagram, TikTok or YouTube",
    );
  });

  it("rejects more than 50 URLs with the exact cap message (ST-02 limit)", async () => {
    const urls = Array.from({ length: 51 }, (_, i) => FIX.ok(i + 1));
    const res = await postBatches(postReq({ urls }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Maximum 50 URLs per batch");
  });

  it("rejects an empty submission", async () => {
    const res = await postBatches(postReq({ urls: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects malformed bodies", async () => {
    const res = await postBatches(postReq({ urls: "not-an-array" }));
    expect(res.status).toBe(400);
  });

  it("dedupes equivalent URLs and notes it on the surviving item (ST-02 duplicates)", async () => {
    const watch = "https://www.youtube.com/watch?v=fix-ok-007";
    const short = "https://youtu.be/fix-ok-007"; // same post, different form
    const res = await postBatches(postReq({ urls: [watch, short] }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.duplicatesRemoved).toBe(1);
    expect(body.items[0].duplicateRemoved).toBe(true);
  });
});

describe("GET /api/batches/:id", () => {
  it("returns full batch state and never leaks audioPath", async () => {
    const created = await (await postBatches(postReq({ urls: [FIX.sttfail] }))).json();
    await waitForSettled(created.batchId);
    const res = await getBatchRoute(new Request("http://localhost"), params(created.batchId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].status).toBe("failed"); // sttfail keeps audio on disk...
    expect(JSON.stringify(body)).not.toContain("audioPath"); // ...but the API never says where
    expect(JSON.stringify(body)).not.toContain("audio.m4a");
  });

  it("404s for unknown batches with the resubmit message (RK-4 accepted behaviour)", async () => {
    const res = await getBatchRoute(new Request("http://localhost"), params("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("This batch is no longer available — please resubmit");
  });

  it("settles a single-URL batch end-to-end through the API (walking skeleton)", async () => {
    const created = await (await postBatches(postReq({ urls: [FIX.ok(9)] }))).json();
    await waitForSettled(created.batchId);
    const body = await (
      await getBatchRoute(new Request("http://localhost"), params(created.batchId))
    ).json();
    const item = body.items[0];
    expect(item.status).toBe("done");
    expect(item.transcript).toBeTruthy();
    expect(item.detectedLanguage).toBeTruthy();
    expect(item.costUsd).toBeGreaterThan(0);
  });
});

describe("GET /api/health", () => {
  it("is ok in mock mode without a key or yt-dlp binary", async () => {
    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mockProviders).toBe(true);
    expect(body.checks.tmpWritable.ok).toBe(true);
  });
});
