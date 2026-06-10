import type { FailureCode } from "../types";

/** Thrown by Fetcher implementations. `rawDetail` is for logs only — never the UI (NFR-6). */
export class FetchFailure extends Error {
  constructor(
    public code: FailureCode,
    public rawDetail: string,
    public retryable: boolean,
    /** Known for too_long rejections so the card can say "This post is 22 minutes." */
    public durationSec?: number,
  ) {
    super(`fetch failed: ${code}`);
    this.name = "FetchFailure";
  }
}

/** Thrown by Transcriber implementations after in-step retries are exhausted. */
export class TranscribeFailure extends Error {
  public code: FailureCode = "provider_error";
  constructor(
    public rawDetail: string,
    public retryable: boolean = true,
  ) {
    super("transcribe failed: provider_error");
    this.name = "TranscribeFailure";
  }
}

export class ExtractFailure extends Error {
  public code: FailureCode = "audio_processing_error";
  constructor(public rawDetail: string) {
    super("extract failed: audio_processing_error");
    this.name = "ExtractFailure";
  }
}
