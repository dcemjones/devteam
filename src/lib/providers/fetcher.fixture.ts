// Fixture fetcher: no network, deterministic per-URL behaviour, but real files on disk so the
// purge/retention logic (NFR-7) is exercised for real.

import path from "node:path";
import fs from "node:fs/promises";
import { getConfig } from "../config";
import { FetchFailure } from "./errors";
import { scenarioFor, fixtureDurationSec } from "./fixtures";
import type { Fetcher, FetchResult } from "./fetcher";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Counts fetch attempts per URL — lets tests assert that retry-from-TRANSCRIBE never refetches. */
export const fetchAttempts = new Map<string, number>();

export class FixtureFetcher implements Fetcher {
  async fetchAudio(url: string, destDir: string, maxDurationSec: number): Promise<FetchResult> {
    const cfg = getConfig();
    await sleep(cfg.fixtureDelayMs);

    const attempts = (fetchAttempts.get(url) ?? 0) + 1;
    fetchAttempts.set(url, attempts);

    const scenario = scenarioFor(url);
    switch (scenario) {
      case "private":
        throw new FetchFailure("private_or_removed", "FIXTURE: ERROR: [generic] Video unavailable. This post is private", true);
      case "geoblock":
        throw new FetchFailure("geo_blocked", "FIXTURE: ERROR: The uploader has not made this video available in your country", true);
      case "loginwall":
        throw new FetchFailure("login_required", "FIXTURE: ERROR: Login required to access this content. Use --cookies", true);
      case "ratelimit":
        throw new FetchFailure("rate_limited", "FIXTURE: ERROR: HTTP Error 429: Too Many Requests", true);
      case "extractor":
        throw new FetchFailure("extractor_error", "FIXTURE: ERROR: Unable to extract webpage data", true);
      case "flakyfetch":
        if (attempts === 1) {
          throw new FetchFailure("unknown", "FIXTURE: transient network error (succeeds on retry)", true);
        }
        break;
      default:
        break;
    }

    const durationSec = fixtureDurationSec(url);
    if (durationSec > maxDurationSec) {
      throw new FetchFailure("too_long", `FIXTURE: duration ${durationSec}s exceeds cap`, false, durationSec);
    }

    const audioPath = path.join(destDir, "audio.m4a");
    // A few KB of deterministic bytes standing in for 64 kbps mono m4a. Never parsed.
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(audioPath, Buffer.alloc(4096, url.length % 256));
    return { audioPath, durationSec };
  }
}
