// /api/health (T-101): tmp writable, OpenAI key present, yt-dlp --version.
// In mock mode the key/binary checks are reported but not required.

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { ensureBooted } from "@/lib/boot";
import { spawnCapture } from "@/lib/providers/spawn";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  ensureBooted();
  const cfg = getConfig();

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // tmp writable
  try {
    await fs.mkdir(cfg.tmpRoot, { recursive: true });
    const probe = path.join(cfg.tmpRoot, `.health-${Date.now()}`);
    await fs.writeFile(probe, "ok");
    await fs.rm(probe, { force: true });
    checks.tmpWritable = { ok: true };
  } catch (e) {
    checks.tmpWritable = { ok: false, detail: String(e) };
  }

  // OpenAI key
  checks.openaiKey = cfg.openaiApiKey
    ? { ok: true }
    : { ok: cfg.mockProviders, detail: cfg.mockProviders ? "skipped (mock mode)" : "OPENAI_API_KEY missing" };

  // yt-dlp binary
  if (cfg.mockProviders) {
    checks.ytDlp = { ok: true, detail: "skipped (mock mode)" };
  } else {
    try {
      const res = await spawnCapture(cfg.ytDlpPath, ["--version"], { timeoutMs: 15_000 });
      checks.ytDlp =
        res.code === 0
          ? { ok: true, detail: res.stdout.trim() }
          : { ok: false, detail: `exit ${res.code}: ${res.stderr.slice(0, 200)}` };
    } catch (e) {
      checks.ytDlp = { ok: false, detail: String(e) };
    }
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { ok, mockProviders: cfg.mockProviders, checks },
    { status: ok ? 200 : 503 },
  );
}
