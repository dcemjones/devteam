// T-302/T-303 (+T-301 server side): batch behaviour end-to-end in fixture mode.
// ST-02: partial failure isolation, independent updates, backpressure, the 50-item budget.

import { beforeEach, describe, expect, it } from "vitest";
import { setupMockEnv, waitForSettled, FIX } from "./helpers";
import { POST as postBatches } from "@/app/api/batches/route";
import { GET as getBatchRoute } from "@/app/api/batches/[id]/route";
import { getBatch, getState } from "@/lib/registry";
import { isSettled } from "@/lib/types";

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

describe("partial batch failure (ST-02)", () => {
  it("10 URLs with 2 failures: 8 succeed untouched, failures carry reasons", async () => {
    const urls = [
      FIX.ok(1), FIX.ok(2), FIX.private, FIX.ok(3), FIX.ok(4),
      FIX.sttfail, FIX.ok(5), FIX.ok(6), FIX.silent, FIX.ok(7),
    ];
    const created = await (await postBatches(postReq({ urls }))).json();
    expect(created.items).toHaveLength(10);
    await waitForSettled(created.batchId);

    const body = await (
      await getBatchRoute(new Request("http://localhost"), params(created.batchId))
    ).json();

    // Cards stay in input order (A-UX1)
    expect(body.items.map((i: { url: string }) => i.url)).toEqual(urls);

    const succeeded = body.items.filter(
      (i: { status: string }) => i.status === "done" || i.status === "no_speech",
    );
    const failed = body.items.filter((i: { status: string }) => i.status === "failed");
    expect(succeeded).toHaveLength(8); // no-speech counts as completed (ST-04)
    expect(failed).toHaveLength(2);
    for (const f of failed) {
      expect(f.error.message).toBeTruthy();
    }
    for (const s of succeeded.filter((i: { status: string }) => i.status === "done")) {
      expect(s.transcript).toBeTruthy(); // successes unaffected by the 2 failures
    }
  });

  it("global concurrency never exceeds 4 while a batch runs (arch §5)", async () => {
    process.env.ITT_FIXTURE_DELAY_MS = "15";
    const created = await (
      await postBatches(postReq({ urls: Array.from({ length: 10 }, (_, i) => FIX.ok(20 + i)) }))
    ).json();
    let max = 0;
    while (!isSettled(getBatch(created.batchId)!)) {
      max = Math.max(max, getState().pool.inFlight);
      expect(getState().pool.inFlight).toBeLessThanOrEqual(4);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(max).toBeGreaterThan(1); // it actually ran concurrently
  });
});

describe("backpressure: max 3 live batches (arch §5, NFR-5)", () => {
  it("the 4th simultaneous batch gets 429 'Server busy'; capacity frees when batches settle", async () => {
    process.env.ITT_FIXTURE_DELAY_MS = "150";
    const live: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await postBatches(postReq({ urls: [FIX.ok(40 + i)] }));
      expect(res.status).toBe(202);
      live.push((await res.json()).batchId);
    }

    const fourth = await postBatches(postReq({ urls: [FIX.ok(49)] }));
    expect(fourth.status).toBe(429);
    expect((await fourth.json()).error).toBe("Server busy — try again in a few minutes");

    for (const id of live) await waitForSettled(id);
    const afterSettle = await postBatches(postReq({ urls: [FIX.ok(50)] }));
    expect(afterSettle.status).toBe(202);
    await waitForSettled((await afterSettle.json()).batchId);
  });
});

describe("50-item batch (NFR-2, fixture-mode budget)", () => {
  it("settles completely, in order, well inside the scaled budget", async () => {
    // Fixture steps take ~2 ms each; the real 30-min budget scales to seconds here.
    // This verifies the machinery (pool drains 50 items, nothing deadlocks), not wall-clock NFR-1.
    const urls = Array.from({ length: 50 }, (_, i) => FIX.ok(100 + i));
    const started = Date.now();
    const created = await (await postBatches(postReq({ urls }))).json();
    expect(created.items).toHaveLength(50);
    await waitForSettled(created.batchId, 15_000);
    expect(Date.now() - started).toBeLessThan(15_000);

    const batch = getBatch(created.batchId)!;
    expect(batch.items.every((i) => i.status === "done")).toBe(true);
  });
});
