// T-203: retry-from-failed-step (ST-04 transient failure), 60-min failed-audio retention,
// transparent restart-from-FETCH when the artifact is gone. Plus T-202 failure variants
// across all three platforms, end-to-end through the fixture pipeline.

import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { setupMockEnv, waitForSettled, FIX } from "../../tests/helpers";
import { createBatch } from "../registry";
import { enqueueBatch, retryItem, itemTmpDir } from "../pipeline";
import { validateBatch } from "../validation";
import { fetchAttempts } from "../providers/fetcher.fixture";
import type { Batch } from "../types";

function makeBatch(urls: string[]): Batch {
  const v = validateBatch(urls);
  if (!v.ok) throw new Error("test URLs failed validation: " + JSON.stringify(v));
  const batch = createBatch(v.items, v.duplicatesRemoved);
  enqueueBatch(batch);
  return batch;
}

beforeEach(() => {
  setupMockEnv();
});

describe("retry resumes from the failed step (ST-04)", () => {
  it("a TRANSCRIBE failure retries WITHOUT refetching (the QA log check)", async () => {
    const batch = makeBatch([FIX.sttflaky]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    expect(item.status).toBe("failed");
    expect(item.error?.step).toBe("TRANSCRIBE_TRANSLATE");
    expect(fetchAttempts.get(FIX.sttflaky)).toBe(1);

    const outcome = await retryItem(batch, item);
    expect(outcome).toEqual({ ok: true, fromStep: "TRANSCRIBE_TRANSLATE" });
    await waitForSettled(batch.id);

    expect(item.status).toBe("done");
    expect(item.transcript).toBeTruthy();
    expect(fetchAttempts.get(FIX.sttflaky)).toBe(1); // FETCH never repeated
    // media purged after the successful retry (NFR-7)
    expect(item.audioPath).toBeUndefined();
    expect(fs.existsSync(itemTmpDir(batch.id, item.id))).toBe(false);
  });

  it("a FETCH failure retries from FETCH and can succeed (flaky fetch)", async () => {
    const batch = makeBatch([FIX.flakyfetch]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    expect(item.status).toBe("failed");
    expect(item.error?.step).toBe("FETCH");

    const outcome = await retryItem(batch, item);
    expect(outcome).toEqual({ ok: true, fromStep: "FETCH" });
    await waitForSettled(batch.id);
    expect(item.status).toBe("done");
    expect(fetchAttempts.get(FIX.flakyfetch)).toBe(2);
  });

  it("transparently restarts from FETCH when the kept audio was purged (arch §4/§8)", async () => {
    const batch = makeBatch([FIX.sttflaky]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    expect(item.audioPath).toBeTruthy();

    // Simulate the 60-min sweep having removed the artifact.
    fs.rmSync(itemTmpDir(batch.id, item.id), { recursive: true, force: true });

    const outcome = await retryItem(batch, item);
    expect(outcome).toEqual({ ok: true, fromStep: "FETCH" });
    await waitForSettled(batch.id);
    expect(item.status).toBe("done");
    expect(fetchAttempts.get(FIX.sttflaky)).toBe(2); // had to refetch — by design
  });

  it("refuses to retry items that are not failed (409 contract)", async () => {
    const batch = makeBatch([FIX.ok(1)]);
    await waitForSettled(batch.id);
    expect(await retryItem(batch, batch.items[0])).toEqual({ ok: false, reason: "not_failed" });
  });

  it("retry clears the error and the card returns to processing states", async () => {
    const batch = makeBatch([FIX.sttflaky]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    await retryItem(batch, item);
    expect(item.error).toBeUndefined();
    expect(item.failedAt).toBeUndefined();
    await waitForSettled(batch.id);
  });
});

describe("fetch-failure variants map to the exact card reasons (T-202, experience spec §5)", () => {
  const cases: { url: string; code: string; reason: string }[] = [
    { url: FIX.private, code: "private_or_removed", reason: "post is private or removed" },
    { url: FIX.geoblock, code: "geo_blocked", reason: "post is not available from this region" },
    { url: FIX.loginwall, code: "login_required", reason: "the platform is asking for a login to view this post" },
    { url: "https://www.youtube.com/watch?v=fixratelimit", code: "rate_limited", reason: "the platform is rate-limiting our requests" },
    { url: "https://www.youtube.com/watch?v=fixextractor1", code: "extractor_error", reason: "the platform changed something and the fetcher needs an update" },
  ];

  for (const c of cases) {
    it(`${c.code} (covers ${new URL(c.url).hostname})`, async () => {
      const batch = makeBatch([c.url]);
      await waitForSettled(batch.id);
      const item = batch.items[0];
      expect(item.status).toBe("failed");
      expect(item.error?.step).toBe("FETCH");
      expect(item.error?.code).toBe(c.code);
      expect(item.error?.message).toBe(c.reason);
      expect(item.error?.retryable).toBe(true);
    });
  }
});

describe("all three platforms succeed end-to-end in fixture mode (M2 demo statement)", () => {
  it("YouTube, TikTok and Instagram URLs each produce a transcript", async () => {
    const batch = makeBatch([FIX.ok(1), FIX.okTikTok, FIX.okInstagram]);
    await waitForSettled(batch.id);
    expect(batch.items.map((i) => i.platform)).toEqual(["youtube", "tiktok", "instagram"]);
    for (const item of batch.items) {
      expect(item.status).toBe("done");
      expect(item.transcript).toBeTruthy();
      expect(item.costUsd).toBeGreaterThan(0);
    }
  });
});
