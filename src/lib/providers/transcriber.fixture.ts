// Fixture transcriber: canned verbose_json-shaped responses keyed off the source URL.

import { getConfig } from "../config";
import { TranscribeFailure } from "./errors";
import { cannedTranslation, fixtureDurationSec, scenarioFor } from "./fixtures";
import type { Transcriber, TranscribeResult } from "./transcriber";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Attempts per URL — drives the `sttflaky` scenario and retry-from-step tests. */
export const transcribeAttempts = new Map<string, number>();

export class FixtureTranscriber implements Transcriber {
  async transcribeTranslate(_audioPath: string, sourceUrl: string): Promise<TranscribeResult> {
    await sleep(getConfig().fixtureDelayMs);

    const attempts = (transcribeAttempts.get(sourceUrl) ?? 0) + 1;
    transcribeAttempts.set(sourceUrl, attempts);

    const scenario = scenarioFor(sourceUrl);
    if (scenario === "sttfail" || (scenario === "sttflaky" && attempts === 1)) {
      throw new TranscribeFailure("FIXTURE: OpenAI HTTP 500: simulated provider error", true);
    }

    const durationSec = fixtureDurationSec(sourceUrl);
    const canned = cannedTranslation(sourceUrl, durationSec);
    return {
      text: canned.text,
      language: canned.language || undefined,
      durationSec: canned.duration,
    };
  }
}
