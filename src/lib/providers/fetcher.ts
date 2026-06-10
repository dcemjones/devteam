// Fetcher interface (T-102). Real = yt-dlp child process; fixture = deterministic offline mode.

import { getConfig } from "../config";
import { RealFetcher } from "./fetcher.real";
import { FixtureFetcher } from "./fetcher.fixture";

export interface FetchResult {
  audioPath: string;
  durationSec: number;
}

export interface Fetcher {
  /**
   * Download the post's audio (m4a, 64 kbps) into `destDir` and return its path + duration.
   * Must reject posts longer than `maxDurationSec` with FetchFailure(code="too_long").
   * Throws FetchFailure on any platform-side failure.
   */
  fetchAudio(url: string, destDir: string, maxDurationSec: number): Promise<FetchResult>;
}

let cached: Fetcher | undefined;

export function getFetcher(): Fetcher {
  if (!cached) {
    cached = getConfig().mockProviders ? new FixtureFetcher() : new RealFetcher();
  }
  return cached;
}

/** Test hook. */
export function _setFetcher(f: Fetcher | undefined): void {
  cached = f;
}
