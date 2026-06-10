// EXTRACT step safety net (arch §4 step 3): yt-dlp -x already produced 64 kbps mono m4a;
// if the file still exceeds the whisper margin (24 MB), re-encode mono 48 kbps with ffmpeg.

import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";
import { log } from "../logger";
import { ExtractFailure } from "./errors";
import { spawnCapture, type SpawnFn } from "./spawn";

export async function reencodeIfNeeded(
  audioPath: string,
  spawnFn: SpawnFn = spawnCapture,
): Promise<string> {
  const cfg = getConfig();
  let size: number;
  try {
    size = (await fs.stat(audioPath)).size;
  } catch (e) {
    throw new ExtractFailure(`audio file missing at EXTRACT: ${String(e)}`);
  }
  if (size <= cfg.reencodeThresholdBytes) return audioPath;

  const out = path.join(path.dirname(audioPath), "audio-48k.m4a");
  const res = await spawnFn(
    cfg.ffmpegPath,
    ["-y", "-i", audioPath, "-ac", "1", "-b:a", "48k", "-vn", out],
    { timeoutMs: 5 * 60 * 1000 },
  );
  if (res.timedOut || res.code !== 0) {
    throw new ExtractFailure(`ffmpeg re-encode failed (code ${res.code}): ${res.stderr.slice(-2000)}`);
  }
  await fs.rm(audioPath, { force: true });
  log("info", "reencoded_oversize_audio", { from: size, audioPath: out });
  return out;
}
