// Transcriber interface (T-102). Real = OpenAI whisper-1 /audio/translations; fixture = canned.

import { getConfig } from "../config";
import { RealTranscriber } from "./transcriber.real";
import { FixtureTranscriber } from "./transcriber.fixture";

export interface TranscribeResult {
  /** English text. Empty/whitespace means "no speech" (handled by the pipeline, not here). */
  text: string;
  /** Raw detected-language value from verbose_json, e.g. "spanish". May be missing (RK-6). */
  language?: string;
  /** Audio duration as reported by the provider, if present. */
  durationSec?: number;
}

export interface Transcriber {
  /**
   * One-call transcribe+translate-to-English (ADR-002). Implementations own the in-step retry
   * policy (timeout 120 s, 2 jittered retries — arch §9) and throw TranscribeFailure after that.
   * `sourceUrl` exists only so the fixture can key scenarios; the real impl ignores it.
   */
  transcribeTranslate(audioPath: string, sourceUrl: string): Promise<TranscribeResult>;
}

let cached: Transcriber | undefined;

export function getTranscriber(): Transcriber {
  if (!cached) {
    cached = getConfig().mockProviders ? new FixtureTranscriber() : new RealTranscriber();
  }
  return cached;
}

/** Test hook. */
export function _setTranscriber(t: Transcriber | undefined): void {
  cached = t;
}
