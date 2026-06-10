// Real transcriber: POST /v1/audio/translations, model whisper-1, response_format=verbose_json.
// Timeout 120 s, 2 jittered in-step retries on 429/5xx/network errors (arch §9).
//
// NOT integration-tested in this sandbox (no OPENAI_API_KEY / egress) — unit-tested with a
// mocked fetch boundary; live verification is launch-blocking item LB-01.

import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";
import { log } from "../logger";
import { TranscribeFailure } from "./errors";
import type { Transcriber, TranscribeResult } from "./transcriber";

type FetchLike = typeof globalThis.fetch;
type SleepFn = (ms: number) => Promise<void>;

const realSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

interface VerboseJson {
  text?: string;
  language?: string;
  duration?: number;
}

export class RealTranscriber implements Transcriber {
  constructor(
    private fetchImpl: FetchLike = globalThis.fetch,
    private sleep: SleepFn = realSleep,
  ) {}

  async transcribeTranslate(audioPath: string, _sourceUrl: string): Promise<TranscribeResult> {
    const cfg = getConfig();
    if (!cfg.openaiApiKey) {
      throw new TranscribeFailure("OPENAI_API_KEY is not configured", false);
    }

    const buf = await fs.readFile(audioPath); // ≤25 MB by construction (extract step)
    const maxAttempts = cfg.openaiMaxRetries + 1;
    let lastDetail = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.openaiTimeoutMs);
      try {
        const form = new FormData();
        form.append("model", "whisper-1");
        form.append("response_format", "verbose_json");
        form.append(
          "file",
          new Blob([new Uint8Array(buf)], { type: "audio/mp4" }),
          path.basename(audioPath),
        );

        const res = await this.fetchImpl(`${cfg.openaiBaseUrl}/audio/translations`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.openaiApiKey}` },
          body: form,
          signal: controller.signal,
        });

        if (res.ok) {
          const json = (await res.json()) as VerboseJson;
          return {
            text: json.text ?? "",
            language: json.language,
            durationSec: typeof json.duration === "number" ? json.duration : undefined,
          };
        }

        const body = await res.text().catch(() => "");
        lastDetail = `OpenAI HTTP ${res.status}: ${body.slice(0, 2000)}`;
        const retryableStatus = res.status === 429 || res.status >= 500;
        if (!retryableStatus) {
          // 4xx other than 429: in-step retries won't help, but the card-level Retry stays
          // available (UX: provider failure is always retryable from the card).
          throw new TranscribeFailure(lastDetail, true);
        }
      } catch (err) {
        if (err instanceof TranscribeFailure) throw err;
        lastDetail =
          err instanceof Error && err.name === "AbortError"
            ? `OpenAI request timed out after ${cfg.openaiTimeoutMs} ms`
            : `OpenAI request error: ${String(err)}`;
      } finally {
        clearTimeout(timer);
      }

      if (attempt < maxAttempts) {
        // Jittered exponential-ish backoff: ~1-2 s then ~2-4 s.
        const backoff = attempt * 1000 + Math.random() * attempt * 1000;
        log("warn", "openai_retry", { attempt, backoffMs: Math.round(backoff), detail: lastDetail });
        await this.sleep(backoff);
      }
    }

    throw new TranscribeFailure(lastDetail || "OpenAI request failed", true);
  }
}
