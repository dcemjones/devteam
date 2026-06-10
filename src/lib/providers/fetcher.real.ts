// Real fetcher: yt-dlp via child process, argv arrays only (threat #2), `--` before the URL.
//
// Two-phase by design: (1) metadata only (`-J`) to read the duration so >15-min posts are
// rejected *before* downloading (arch §4 step 2: "parse duration from metadata; reject >15 min",
// and the card copy needs the real duration: "This post is 22 minutes."); (2) audio download.
// Cost: one extra platform request per item — acceptable at ≤4 concurrent workers (ADR-001).
//
// NOT integration-tested in this sandbox (no platform reachability) — unit-tested with a
// mocked spawn boundary; live verification is launch-blocking item LB-01.

import path from "node:path";
import fs from "node:fs/promises";
import { getConfig } from "../config";
import { mapYtDlpStderr } from "../taxonomy";
import { FetchFailure } from "./errors";
import { spawnCapture, type SpawnFn } from "./spawn";
import type { Fetcher, FetchResult } from "./fetcher";

export class RealFetcher implements Fetcher {
  constructor(private spawnFn: SpawnFn = spawnCapture) {}

  async fetchAudio(url: string, destDir: string, maxDurationSec: number): Promise<FetchResult> {
    const cfg = getConfig();

    // Phase 1 — metadata (no download).
    const meta = await this.spawnFn(cfg.ytDlpPath, ["-J", "--no-playlist", "--", url], {
      timeoutMs: 2 * 60 * 1000,
    });
    if (meta.timedOut) throw new FetchFailure("unknown", "yt-dlp metadata fetch timed out", true);
    if (meta.code !== 0) {
      throw new FetchFailure(mapYtDlpStderr(meta.stderr), meta.stderr.slice(-4000), true);
    }

    let durationSec: number;
    try {
      const info = JSON.parse(meta.stdout) as { duration?: number };
      durationSec = typeof info.duration === "number" ? info.duration : NaN;
    } catch (e) {
      throw new FetchFailure("extractor_error", `unparseable yt-dlp -J output: ${String(e)}`, true);
    }

    if (Number.isFinite(durationSec) && durationSec > maxDurationSec) {
      throw new FetchFailure(
        "too_long",
        `duration ${durationSec}s exceeds cap ${maxDurationSec}s`,
        false, // retry won't help
        durationSec,
      );
    }

    // Phase 2 — audio-only download. Output template is ours; only the URL is user-influenced,
    // and it sits after `--` as a single argv element.
    const outTemplate = path.join(destDir, "audio.%(ext)s");
    const dl = await this.spawnFn(
      cfg.ytDlpPath,
      [
        "-x",
        "--audio-format", "m4a",
        "--audio-quality", "64K",
        "-o", outTemplate,
        "--no-playlist",
        "--max-filesize", "200M",
        "--no-progress",
        "--", url,
      ],
      { timeoutMs: 10 * 60 * 1000 },
    );
    if (dl.timedOut) throw new FetchFailure("unknown", "yt-dlp download timed out", true);
    if (dl.code !== 0) {
      throw new FetchFailure(mapYtDlpStderr(dl.stderr), dl.stderr.slice(-4000), true);
    }

    const audioPath = path.join(destDir, "audio.m4a");
    try {
      await fs.access(audioPath);
    } catch {
      throw new FetchFailure(
        "extractor_error",
        `yt-dlp exited 0 but ${audioPath} is missing; stderr tail: ${dl.stderr.slice(-1000)}`,
        true,
      );
    }

    return {
      audioPath,
      durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    };
  }
}
