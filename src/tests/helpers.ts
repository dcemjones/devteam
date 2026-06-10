// Shared test plumbing: every test runs in mock-provider mode with an isolated tmp root
// and fresh in-memory state. No test needs the live network (delivery-plan DoD #2).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _resetState, getBatch } from "@/lib/registry";
import { _setFetcher } from "@/lib/providers/fetcher";
import { _setTranscriber } from "@/lib/providers/transcriber";
import { fetchAttempts } from "@/lib/providers/fetcher.fixture";
import { transcribeAttempts } from "@/lib/providers/transcriber.fixture";
import { isSettled } from "@/lib/types";

export function setupMockEnv(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itt-test-"));
  process.env.MOCK_PROVIDERS = "1";
  process.env.ITT_TMP_DIR = tmp;
  process.env.ITT_FIXTURE_DELAY_MS = "2";
  delete process.env.OPENAI_API_KEY;
  delete process.env.ITT_POOL_CONCURRENCY;
  delete process.env.ITT_MAX_LIVE_BATCHES;
  _resetState();
  _setFetcher(undefined);
  _setTranscriber(undefined);
  fetchAttempts.clear();
  transcribeAttempts.clear();
  return tmp;
}

export async function waitForSettled(batchId: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const b = getBatch(batchId);
    if (b && isSettled(b)) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`batch ${batchId} did not settle within ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Valid post URLs that trigger fixture scenarios (see lib/providers/fixtures.ts). */
export const FIX = {
  ok: (n = 1) => `https://www.youtube.com/watch?v=fix-ok-${String(n).padStart(3, "0")}`,
  okTikTok: "https://www.tiktok.com/@creator/video/7234567890123456789",
  okInstagram: "https://www.instagram.com/reel/Cfixokreel01/",
  private: "https://www.youtube.com/watch?v=fix-private-01",
  geoblock: "https://www.tiktok.com/@creator/video/7234567890009998887?geoblock=1",
  loginwall: "https://www.instagram.com/p/Cfixloginwall/",
  toolong: "https://www.youtube.com/watch?v=fix-toolong-01",
  silent: "https://www.youtube.com/watch?v=fix-silent-01",
  english: "https://www.youtube.com/watch?v=fix-english-01",
  sttflaky: "https://www.youtube.com/watch?v=fix-sttflaky-1",
  sttfail: "https://www.youtube.com/watch?v=fix-sttfail-01",
  flakyfetch: "https://www.youtube.com/watch?v=fixflakyfetch",
};
