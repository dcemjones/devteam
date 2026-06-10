// Per-item step machine: FETCH → EXTRACT → TRANSCRIBE_TRANSLATE → DONE (arch §4).
// Owns: per-item temp dir, purge on completion (NFR-7), JSON-line step logs (NFR-6),
// costUsd (NFR-9), retry-from-failed-step (ST-04).

import path from "node:path";
import fs from "node:fs/promises";
import type { Batch, FailureCode, Item, Step } from "./types";
import { getConfig } from "./config";
import { log } from "./logger";
import { costUsd } from "./cost";
import { displayLanguage } from "./languages";
import { getFetcher } from "./providers/fetcher";
import { getTranscriber } from "./providers/transcriber";
import { reencodeIfNeeded } from "./providers/extractor";
import { FetchFailure, TranscribeFailure, ExtractFailure } from "./providers/errors";
import { FAILURE_DETAIL } from "./taxonomy";
import { getState, isSettled } from "./registry";

export function itemTmpDir(batchId: string, itemId: string): string {
  return path.join(getConfig().tmpRoot, batchId, itemId);
}

async function purgeItemDir(batch: Batch, item: Item): Promise<void> {
  const dir = itemTmpDir(batch.id, item.id);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  item.audioPath = undefined;
  log("info", "media_purged", { batchId: batch.id, itemId: item.id });
}

function startStep(item: Item, step: Step): void {
  item.timings[step] = { startedAt: new Date().toISOString() };
}

function endStep(batch: Batch, item: Item, step: Step): void {
  const t = item.timings[step];
  if (t) t.endedAt = new Date().toISOString();
  item.lastCompletedStep = step;
  log("info", "step_completed", {
    batchId: batch.id,
    itemId: item.id,
    url: item.url,
    platform: item.platform,
    step,
    durationMs: t ? Date.parse(t.endedAt!) - Date.parse(t.startedAt) : undefined,
  });
}

interface StepFailureInfo {
  code: FailureCode;
  userMessage: string;
  retryable: boolean;
  rawDetail: string;
}

function failureFromError(err: unknown, item: Item): StepFailureInfo {
  if (err instanceof FetchFailure) {
    if (err.code === "too_long") {
      const minutes = err.durationSec ? Math.round(err.durationSec / 60) : undefined;
      if (err.durationSec) item.durationSec = err.durationSec;
      return {
        code: "too_long",
        userMessage:
          minutes !== undefined
            ? `This post is ${minutes} minutes. Shorter posts up to 15 minutes are supported.`
            : "Shorter posts up to 15 minutes are supported.",
        retryable: false,
        rawDetail: err.rawDetail,
      };
    }
    return {
      code: err.code,
      userMessage: FAILURE_DETAIL[err.code],
      retryable: err.retryable,
      rawDetail: err.rawDetail,
    };
  }
  if (err instanceof TranscribeFailure) {
    return {
      code: "provider_error",
      userMessage: "The transcription service returned an error — retrying usually fixes this.",
      retryable: true,
      rawDetail: err.rawDetail,
    };
  }
  if (err instanceof ExtractFailure) {
    return {
      code: "audio_processing_error",
      userMessage: FAILURE_DETAIL.audio_processing_error,
      retryable: true,
      rawDetail: err.rawDetail,
    };
  }
  return {
    code: "unknown",
    userMessage: FAILURE_DETAIL.unknown,
    retryable: true,
    rawDetail: String(err),
  };
}

/**
 * Run one item from `fromStep` (default FETCH). Never throws: every failure becomes item state.
 * Per-item isolation (ST-02): nothing here touches sibling items.
 */
export async function runItem(batch: Batch, item: Item, fromStep: Step = "FETCH"): Promise<void> {
  const cfg = getConfig();
  const dir = itemTmpDir(batch.id, item.id);
  let step: Step = fromStep;

  try {
    if (step === "FETCH") {
      item.status = "fetching";
      startStep(item, "FETCH");
      await fs.mkdir(dir, { recursive: true });
      const fetched = await getFetcher().fetchAudio(item.url, dir, cfg.maxDurationSec);
      item.audioPath = fetched.audioPath;
      item.durationSec = fetched.durationSec;
      endStep(batch, item, "FETCH");
      step = "EXTRACT";
    }

    if (step === "EXTRACT") {
      item.status = "extracting";
      startStep(item, "EXTRACT");
      if (!item.audioPath) throw new ExtractFailure("no audioPath at EXTRACT (artifact lost)");
      item.audioPath = await reencodeIfNeeded(item.audioPath);
      endStep(batch, item, "EXTRACT");
      step = "TRANSCRIBE_TRANSLATE";
    }

    // TRANSCRIBE_TRANSLATE
    item.status = "transcribing";
    startStep(item, "TRANSCRIBE_TRANSLATE");
    if (!item.audioPath) throw new TranscribeFailure("no audioPath at TRANSCRIBE (artifact lost)", true);
    const result = await getTranscriber().transcribeTranslate(item.audioPath, item.url);
    endStep(batch, item, "TRANSCRIBE_TRANSLATE");

    if (result.durationSec && !item.durationSec) item.durationSec = result.durationSec;
    item.costUsd = costUsd(item.durationSec ?? result.durationSec ?? 0);

    // NFR-7: purge BEFORE flipping to a terminal status, so nothing that observes a settled
    // item (polling, tests, sweeper) can ever see completed-but-media-still-on-disk.
    await purgeItemDir(batch, item);

    if (!result.text || result.text.trim() === "") {
      // ST-04: counted as completed, not failed.
      item.status = "no_speech";
      item.transcript = undefined;
    } else {
      item.status = "done";
      item.transcript = result.text.trim();
      item.detectedLanguage = displayLanguage(result.language);
    }
    log("info", "item_completed", {
      batchId: batch.id,
      itemId: item.id,
      url: item.url,
      platform: item.platform,
      status: item.status,
      detectedLanguage: item.detectedLanguage,
      durationSec: item.durationSec,
      costUsd: item.costUsd,
    });
  } catch (err) {
    const info = failureFromError(err, item);
    const failedStep: Step =
      item.status === "fetching" ? "FETCH" : item.status === "extracting" ? "EXTRACT" : "TRANSCRIBE_TRANSLATE";
    const t = item.timings[failedStep];
    if (t && !t.endedAt) t.endedAt = new Date().toISOString();

    // Failed items keep their audio for the retry window (arch §8) — EXCEPT non-retryable
    // too_long rejections, where the audio (if any) is useless: purge immediately, and do it
    // before the terminal status lands (same no-settled-with-media invariant as success).
    if (!info.retryable) {
      await purgeItemDir(batch, item);
    }

    item.status = "failed";
    item.failedAt = new Date().toISOString();
    item.error = {
      step: failedStep,
      code: info.code,
      message: info.userMessage,
      retryable: info.retryable,
    };

    log("error", "item_failed", {
      batchId: batch.id,
      itemId: item.id,
      url: item.url,
      platform: item.platform,
      step: failedStep,
      code: info.code,
      retryable: info.retryable,
      // Raw provider/yt-dlp detail goes to logs ONLY (NFR-6) — never to the API/UI.
      rawDetail: info.rawDetail,
    });
  } finally {
    if (isSettled(batch)) {
      const succeeded = batch.items.filter((i) => i.status === "done" || i.status === "no_speech").length;
      log("info", "batch_settled", {
        batchId: batch.id,
        total: batch.items.length,
        succeeded,
        failed: batch.items.length - succeeded,
        totalCostUsd: Math.round(batch.items.reduce((s, i) => s + (i.costUsd ?? 0), 0) * 1000) / 1000,
      });
    }
  }
}

/** Enqueue every item of a freshly created batch. */
export function enqueueBatch(batch: Batch): void {
  for (const item of batch.items) {
    getState().pool.submit(batch.id, () => runItem(batch, item));
  }
}

export type RetryOutcome = { ok: true; fromStep: Step } | { ok: false; reason: "not_failed" };

/**
 * Retry-from-failed-step (T-203). Resumes at the failed step; if the step needs the audio
 * artifact and it was purged (60-min window expired), transparently restarts from FETCH.
 */
export async function retryItem(batch: Batch, item: Item): Promise<RetryOutcome> {
  if (item.status !== "failed" || !item.error) return { ok: false, reason: "not_failed" };

  let fromStep: Step = item.error.step;
  if (fromStep !== "FETCH") {
    const artifactAlive =
      item.audioPath !== undefined &&
      (await fs.access(item.audioPath).then(() => true, () => false));
    if (!artifactAlive) {
      fromStep = "FETCH"; // transparent restart (arch §4)
      item.audioPath = undefined;
    }
  }

  item.status = "queued";
  item.error = undefined;
  item.failedAt = undefined;
  log("info", "item_retry", { batchId: batch.id, itemId: item.id, url: item.url, fromStep });
  getState().pool.submit(batch.id, () => runItem(batch, item, fromStep));
  return { ok: true, fromStep };
}
