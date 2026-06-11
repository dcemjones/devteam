// T-202/T-204: the REAL provider implementations, unit-tested at their process/HTTP boundaries
// (mocked SpawnFn / mocked fetch). Live verification of the real network paths is LB-01.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { setupMockEnv } from "../../tests/helpers";
import { RealFetcher } from "../providers/fetcher.real";
import { RealTranscriber } from "../providers/transcriber.real";
import { reencodeIfNeeded } from "../providers/extractor";
import { FetchFailure, TranscribeFailure, ExtractFailure } from "../providers/errors";
import type { SpawnFn, SpawnResult } from "../providers/spawn";

const URL_OK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function spawnResult(over: Partial<SpawnResult> = {}): SpawnResult {
  return { code: 0, stdout: "", stderr: "", timedOut: false, ...over };
}

let tmp: string;
beforeEach(() => {
  setupMockEnv();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "itt-real-"));
});

describe("RealFetcher (mocked spawn)", () => {
  it("two-phase: -J metadata first, then audio download; argv arrays with -- before the URL (threat #2)", async () => {
    const calls: { bin: string; args: string[] }[] = [];
    const spawnFn: SpawnFn = async (bin, args) => {
      calls.push({ bin, args });
      if (args[0] === "-J") return spawnResult({ stdout: JSON.stringify({ duration: 120 }) });
      // phase 2: produce the file yt-dlp would have written
      fs.writeFileSync(path.join(tmp, "audio.m4a"), "x");
      return spawnResult();
    };

    const res = await new RealFetcher(spawnFn).fetchAudio(URL_OK, tmp, 900);
    expect(res.durationSec).toBe(120);
    expect(res.audioPath).toBe(path.join(tmp, "audio.m4a"));

    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.bin).toBe("yt-dlp");
      // URL is exactly one argv element, immediately after `--`, always last.
      expect(c.args[c.args.length - 1]).toBe(URL_OK);
      expect(c.args[c.args.length - 2]).toBe("--");
    }
    expect(calls[0].args[0]).toBe("-J");
    expect(calls[1].args).toContain("--max-filesize");
  });

  it("rejects >15-min posts at the metadata phase, BEFORE downloading (arch §4)", async () => {
    const calls: string[][] = [];
    const spawnFn: SpawnFn = async (_bin, args) => {
      calls.push(args);
      return spawnResult({ stdout: JSON.stringify({ duration: 22 * 60 }) });
    };
    const err = await new RealFetcher(spawnFn)
      .fetchAudio(URL_OK, tmp, 900)
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(FetchFailure);
    const f = err as FetchFailure;
    expect(f.code).toBe("too_long");
    expect(f.retryable).toBe(false);
    expect(f.durationSec).toBe(22 * 60); // card copy needs the real duration
    expect(calls).toHaveLength(1); // download phase never ran
  });

  it("maps non-zero metadata exit through the stderr taxonomy", async () => {
    const spawnFn: SpawnFn = async () =>
      spawnResult({ code: 1, stderr: "ERROR: [youtube] abc: Video unavailable" });
    const err = (await new RealFetcher(spawnFn)
      .fetchAudio(URL_OK, tmp, 900)
      .catch((e: unknown) => e)) as FetchFailure;
    expect(err.code).toBe("private_or_removed");
    expect(err.retryable).toBe(true);
  });

  it("maps download-phase failures and timeouts", async () => {
    const rateLimited: SpawnFn = async (_b, args) =>
      args[0] === "-J"
        ? spawnResult({ stdout: JSON.stringify({ duration: 60 }) })
        : spawnResult({ code: 1, stderr: "ERROR: HTTP Error 429: Too Many Requests" });
    let err = (await new RealFetcher(rateLimited)
      .fetchAudio(URL_OK, tmp, 900)
      .catch((e: unknown) => e)) as FetchFailure;
    expect(err.code).toBe("rate_limited");

    const timesOut: SpawnFn = async () => spawnResult({ code: null, timedOut: true });
    err = (await new RealFetcher(timesOut)
      .fetchAudio(URL_OK, tmp, 900)
      .catch((e: unknown) => e)) as FetchFailure;
    expect(err.code).toBe("unknown");
    expect(err.retryable).toBe(true);
  });

  it("treats exit-0-but-no-file as extractor_error", async () => {
    const spawnFn: SpawnFn = async (_b, args) =>
      args[0] === "-J" ? spawnResult({ stdout: JSON.stringify({ duration: 60 }) }) : spawnResult();
    const err = (await new RealFetcher(spawnFn)
      .fetchAudio(URL_OK, tmp, 900)
      .catch((e: unknown) => e)) as FetchFailure;
    expect(err.code).toBe("extractor_error");
  });
});

describe("RealTranscriber (mocked fetch)", () => {
  function audioFile(): string {
    const p = path.join(tmp, "audio.m4a");
    fs.writeFileSync(p, "fake-audio");
    return p;
  }
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  });

  it("POSTs whisper-1 verbose_json to /audio/translations with the bearer key, parses text+language+duration", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return ok({ task: "translate", language: "portuguese", duration: 161, text: "Good morning guys!" });
    }) as typeof fetch;

    const res = await new RealTranscriber(fetchImpl, async () => {}).transcribeTranslate(audioFile(), URL_OK);
    expect(res).toEqual({ text: "Good morning guys!", language: "portuguese", durationSec: 161 });

    expect(captured!.url).toBe("https://api.openai.com/v1/audio/translations");
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test-not-a-real-key",
    );
    const form = captured!.init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("retries in-step on 429/5xx with jittered backoff, then succeeds (arch §9)", async () => {
    const backoffs: number[] = [];
    let attempt = 0;
    const fetchImpl = (async () => {
      attempt++;
      if (attempt === 1) return new Response("rate limited", { status: 429 });
      if (attempt === 2) return new Response("oops", { status: 500 });
      return ok({ language: "spanish", duration: 60, text: "Hi everyone!" });
    }) as typeof fetch;

    const res = await new RealTranscriber(fetchImpl, async (ms) => {
      backoffs.push(ms);
    }).transcribeTranslate(audioFile(), URL_OK);
    expect(res.text).toBe("Hi everyone!");
    expect(attempt).toBe(3); // 1 try + 2 in-step retries (default ITT_OPENAI_MAX_RETRIES=2)
    expect(backoffs).toHaveLength(2);
    expect(backoffs[1]).toBeGreaterThanOrEqual(backoffs[0] - 1000); // roughly increasing
  });

  it("exhausted retries surface as a retryable TranscribeFailure with the raw detail kept for logs only", async () => {
    const fetchImpl = (async () => new Response("server melted", { status: 503 })) as typeof fetch;
    const err = (await new RealTranscriber(fetchImpl, async () => {})
      .transcribeTranslate(audioFile(), URL_OK)
      .catch((e: unknown) => e)) as TranscribeFailure;
    expect(err).toBeInstanceOf(TranscribeFailure);
    expect(err.retryable).toBe(true);
    expect(err.rawDetail).toContain("503");
  });

  it("does NOT burn in-step retries on non-retryable 4xx", async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts++;
      return new Response("bad audio", { status: 400 });
    }) as typeof fetch;
    const err = (await new RealTranscriber(fetchImpl, async () => {})
      .transcribeTranslate(audioFile(), URL_OK)
      .catch((e: unknown) => e)) as TranscribeFailure;
    expect(err).toBeInstanceOf(TranscribeFailure);
    expect(attempts).toBe(1);
  });

  it("times out via AbortController and reports it", async () => {
    process.env.ITT_OPENAI_TIMEOUT_MS = "20";
    process.env.ITT_OPENAI_MAX_RETRIES = "0";
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      })) as typeof fetch;
    const err = (await new RealTranscriber(fetchImpl)
      .transcribeTranslate(audioFile(), URL_OK)
      .catch((e: unknown) => e)) as TranscribeFailure;
    expect(err).toBeInstanceOf(TranscribeFailure);
    expect(err.rawDetail).toContain("timed out");
    delete process.env.ITT_OPENAI_TIMEOUT_MS;
    delete process.env.ITT_OPENAI_MAX_RETRIES;
  });

  it("fails fast when no key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const err = (await new RealTranscriber()
      .transcribeTranslate(audioFile(), URL_OK)
      .catch((e: unknown) => e)) as TranscribeFailure;
    expect(err).toBeInstanceOf(TranscribeFailure);
    expect(err.rawDetail).toContain("OPENAI_API_KEY");
  });
});

describe("reencodeIfNeeded (EXTRACT safety net, arch §4 step 3)", () => {
  it("passes small files through untouched", async () => {
    const p = path.join(tmp, "audio.m4a");
    fs.writeFileSync(p, Buffer.alloc(1024));
    const spawnFn: SpawnFn = async () => {
      throw new Error("ffmpeg must not run for small files");
    };
    expect(await reencodeIfNeeded(p, spawnFn)).toBe(p);
  });

  it("re-encodes oversize files to mono 48k and removes the original", async () => {
    process.env.ITT_REENCODE_THRESHOLD_BYTES = "100";
    const p = path.join(tmp, "audio.m4a");
    fs.writeFileSync(p, Buffer.alloc(1024));
    let args: string[] = [];
    const spawnFn: SpawnFn = async (bin, a) => {
      expect(bin).toBe("ffmpeg");
      args = a;
      fs.writeFileSync(a[a.length - 1], Buffer.alloc(10));
      return spawnResult();
    };
    const out = await reencodeIfNeeded(p, spawnFn);
    expect(out).toBe(path.join(tmp, "audio-48k.m4a"));
    expect(args).toContain("-ac");
    expect(args).toContain("48k");
    expect(fs.existsSync(p)).toBe(false);
    delete process.env.ITT_REENCODE_THRESHOLD_BYTES;
  });

  it("missing input file is an ExtractFailure", async () => {
    const err = (await reencodeIfNeeded(path.join(tmp, "nope.m4a")).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(ExtractFailure);
  });
});
