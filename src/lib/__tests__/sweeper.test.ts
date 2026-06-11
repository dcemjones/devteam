// T-203: the sweeper — 60-min failed-audio retention, 24 h batch TTL eviction, orphan tmp dirs.
// Time is injected (`sweep(now)`); no fake timers needed.

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { setupMockEnv, waitForSettled, FIX } from "../../tests/helpers";
import { createBatch, getState } from "../registry";
import { enqueueBatch, itemTmpDir } from "../pipeline";
import { sweep } from "../sweeper";
import { validateBatch } from "../validation";

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = setupMockEnv();
});

async function failedBatch() {
  const v = validateBatch([FIX.sttfail]);
  if (!v.ok) throw new Error("bad fixture url");
  const batch = createBatch(v.items, 0);
  enqueueBatch(batch);
  await waitForSettled(batch.id);
  return batch;
}

describe("failed-audio retention window (arch §8)", () => {
  it("keeps failed audio inside the 60-min window", async () => {
    const batch = await failedBatch();
    const item = batch.items[0];
    expect(fs.existsSync(item.audioPath!)).toBe(true);

    await sweep(Date.parse(item.failedAt!) + 59 * 60 * 1000);
    expect(item.audioPath).toBeTruthy();
    expect(fs.existsSync(itemTmpDir(batch.id, item.id))).toBe(true);
  });

  it("purges failed audio after the window so retry restarts from FETCH", async () => {
    const batch = await failedBatch();
    const item = batch.items[0];

    await sweep(Date.parse(item.failedAt!) + 61 * 60 * 1000);
    expect(item.audioPath).toBeUndefined();
    expect(fs.existsSync(itemTmpDir(batch.id, item.id))).toBe(false);
    // item itself survives — only the media is gone
    expect(item.status).toBe("failed");
  });
});

describe("batch TTL eviction (24 h)", () => {
  it("evicts expired batches and their temp dirs", async () => {
    const batch = await failedBatch();
    await sweep(Date.parse(batch.expiresAt) + 1);
    expect(getState().batches.has(batch.id)).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, batch.id))).toBe(false);
  });
});

describe("orphan temp dirs (crash leftovers)", () => {
  it("removes dirs under tmpRoot that belong to no live batch", async () => {
    const orphan = path.join(tmpRoot, "dead-batch-id");
    fs.mkdirSync(path.join(orphan, "item-1"), { recursive: true });
    fs.writeFileSync(path.join(orphan, "item-1", "audio.m4a"), "x");

    const live = await failedBatch(); // has retained audio that must survive the sweep
    await sweep();

    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(itemTmpDir(live.id, live.items[0].id))).toBe(true);
  });
});
