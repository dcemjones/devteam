// T-103: per-item step machine, purge on completion (NFR-7), cost logging (NFR-9).
// Runs entirely in fixture mode — no network.

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { setupMockEnv, waitForSettled, FIX } from "../../tests/helpers";
import { createBatch } from "../registry";
import { enqueueBatch, itemTmpDir } from "../pipeline";
import { validateBatch } from "../validation";

function makeBatch(urls: string[]) {
  const v = validateBatch(urls);
  if (!v.ok) throw new Error("test URLs failed validation: " + JSON.stringify(v));
  const batch = createBatch(v.items, v.duplicatesRemoved);
  enqueueBatch(batch);
  return batch;
}

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = setupMockEnv();
});

describe("single-item happy path (ST-01)", () => {
  it("runs FETCH → EXTRACT → TRANSCRIBE_TRANSLATE → done with transcript + language + cost", async () => {
    const batch = makeBatch([FIX.ok(1)]);
    await waitForSettled(batch.id);

    const item = batch.items[0];
    expect(item.status).toBe("done");
    expect(item.transcript).toBeTruthy();
    expect(["Spanish", "Portuguese"]).toContain(item.detectedLanguage);
    expect(item.durationSec).toBeGreaterThan(0);
    expect(item.costUsd).toBeGreaterThan(0);
    expect(item.lastCompletedStep).toBe("TRANSCRIBE_TRANSLATE");
    // All three steps have closed timings (NFR-6 step timing evidence).
    for (const step of ["FETCH", "EXTRACT", "TRANSCRIBE_TRANSLATE"] as const) {
      expect(item.timings[step]?.startedAt).toBeTruthy();
      expect(item.timings[step]?.endedAt).toBeTruthy();
    }
  });

  it("purges the item temp dir after completion (NFR-7)", async () => {
    const batch = makeBatch([FIX.ok(2)]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    expect(item.audioPath).toBeUndefined();
    expect(fs.existsSync(itemTmpDir(batch.id, item.id))).toBe(false);
  });
});

describe("no-speech post (ST-03/ST-04)", () => {
  it("empty transcript becomes no_speech (completed, not failed) and media is purged", async () => {
    const batch = makeBatch([FIX.silent]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    expect(item.status).toBe("no_speech");
    expect(item.transcript).toBeUndefined();
    expect(item.error).toBeUndefined();
    expect(fs.existsSync(itemTmpDir(batch.id, item.id))).toBe(false);
  });
});

describe("English-source post (ST-03)", () => {
  it("keeps the transcript and detects English", async () => {
    const batch = makeBatch([FIX.english]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    expect(item.status).toBe("done");
    expect(item.detectedLanguage).toBe("English");
  });
});

describe("failure keeps audio for the retry window (arch §8)", () => {
  it("a TRANSCRIBE failure leaves status=failed with audio retained and failedAt set", async () => {
    const batch = makeBatch([FIX.sttfail]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    expect(item.status).toBe("failed");
    expect(item.error?.step).toBe("TRANSCRIBE_TRANSLATE");
    expect(item.error?.code).toBe("provider_error");
    expect(item.error?.retryable).toBe(true);
    expect(item.failedAt).toBeTruthy();
    expect(item.audioPath).toBeTruthy();
    expect(fs.existsSync(item.audioPath!)).toBe(true);
  });

  it("a non-retryable too_long rejection purges immediately and records the duration", async () => {
    const batch = makeBatch([FIX.toolong]);
    await waitForSettled(batch.id);
    const item = batch.items[0];
    expect(item.status).toBe("failed");
    expect(item.error?.code).toBe("too_long");
    expect(item.error?.retryable).toBe(false);
    expect(item.error?.message).toContain("This post is 22 minutes");
    expect(item.audioPath).toBeUndefined();
    expect(fs.existsSync(itemTmpDir(batch.id, item.id))).toBe(false);
  });
});

describe("batch tmp hygiene", () => {
  it("leaves nothing under the tmp root for a fully successful batch", async () => {
    const batch = makeBatch([FIX.ok(3), FIX.ok(4)]);
    await waitForSettled(batch.id);
    const batchDir = path.join(tmpRoot, batch.id);
    const leftovers = fs.existsSync(batchDir) ? fs.readdirSync(batchDir) : [];
    expect(leftovers).toEqual([]);
  });
});
