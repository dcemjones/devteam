// In-memory data model — architecture §6. There is no durable store by design (NFR-7).

export type Platform = "youtube" | "tiktok" | "instagram";

export type Step = "FETCH" | "EXTRACT" | "TRANSCRIBE_TRANSLATE";

export type ItemStatus =
  | "queued"
  | "fetching"
  | "extracting"
  | "transcribing"
  | "done"
  | "no_speech"
  | "failed";

/** Failure taxonomy — architecture §9. `too_long` and `provider_error` are step-specific additions. */
export type FailureCode =
  | "private_or_removed"
  | "geo_blocked"
  | "login_required"
  | "rate_limited"
  | "extractor_error"
  | "too_long"
  | "audio_processing_error"
  | "provider_error"
  | "unknown";

export interface ItemError {
  step: Step;
  code: FailureCode;
  /** Plain-language, user-facing message. Raw stderr/provider detail goes to logs only (NFR-6). */
  message: string;
  retryable: boolean;
}

export interface StepTiming {
  startedAt: string;
  endedAt?: string;
}

export interface Item {
  id: string;
  /** URL exactly as submitted. */
  url: string;
  normalizedUrl: string;
  platform: Platform;
  status: ItemStatus;
  lastCompletedStep?: Step;
  /** Temp audio file; undefined after purge. NEVER serialised to the API (see toPublicBatch). */
  audioPath?: string;
  durationSec?: number;
  /** Human-readable, e.g. "Portuguese". "English (no translation applied)" labelling is a UI concern. */
  detectedLanguage?: string;
  transcript?: string;
  error?: ItemError;
  costUsd?: number;
  timings: Partial<Record<Step, StepTiming>>;
  /** True on the surviving card when the submitted list contained this URL more than once (ST-02). */
  duplicateRemoved?: boolean;
  /** Set when the item enters `failed`; drives the 60-min failed-audio retention sweep (arch §8). */
  failedAt?: string;
}

export interface Batch {
  /** crypto-random — it IS the access token (NFR-4). */
  id: string;
  createdAt: string;
  items: Item[];
  /** Items rejected at VALIDATE. Always empty in v1: submit is all-or-nothing (A-UX5), kept for the §6 shape. */
  rejected: { url: string; reason: string }[];
  duplicatesRemoved: number;
  /** TTL eviction, 24 h. */
  expiresAt: string;
}

/** What the API returns: a Batch with audioPath/failedAt stripped from items. */
export type PublicItem = Omit<Item, "audioPath" | "failedAt">;
export type PublicBatch = Omit<Batch, "items"> & { items: PublicItem[] };

export const TERMINAL_STATUSES: ReadonlySet<ItemStatus> = new Set([
  "done",
  "no_speech",
  "failed",
]);

export function isSettled(batch: { items: { status: ItemStatus }[] }): boolean {
  return batch.items.every((i) => TERMINAL_STATUSES.has(i.status));
}
