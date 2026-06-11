# Influencer Transcript Translator (ITT)

Paste 1–50 public Instagram / TikTok / YouTube post URLs, get back per-post English
transcripts (source language auto-detected), copy them or export the batch as CSV.
Internal tool, no auth, no database — by requirement (PRD NFR-4/NFR-7).

This is a **standalone** Next.js + TypeScript app. It must never import from, or be
imported by, the repo-root dashboard app. Its own `package-lock.json` is authoritative.

## Run

```bash
npm ci

# Offline / demo mode — deterministic fixture providers, no network, no key needed:
MOCK_PROVIDERS=1 npm run dev          # http://localhost:3100

# Real mode — needs OPENAI_API_KEY plus yt-dlp and ffmpeg on PATH:
OPENAI_API_KEY=sk-... npm run dev
```

Fixture mode recognises URL markers (`fix-private-01`, `fix-toolong-01`, `fix-silent-01`,
`fix-english-01`, `fix-sttflaky-1`, …) — see `lib/providers/fixtures.ts` for the full list.
Anything else succeeds with a canned Spanish/Portuguese transcript.

**Dev caveat:** `next dev` hot-reload recycles the in-memory state — in-flight batches
vanish on file save. That is dev-only noise; the same restart-loses-state behaviour in
production is an accepted trade (RK-4): the UI shows "This batch is no longer available —
please resubmit".

## Test / typecheck / build

```bash
npm test            # vitest — all suites run offline in fixture mode
npm run typecheck   # tsc --noEmit
npm run build       # next build (standalone output)
```

## Deploy — read this before you ship

```bash
docker build -t itt .                                  # latest yt-dlp
docker build --build-arg YTDLP_VERSION=<tag> -t itt .  # pinned (preferred after LB-01)
docker run -p 3100:3100 -e OPENAI_API_KEY=sk-... itt
```

Hard requirements (architecture §13, ADR-003):

1. **Exactly ONE instance, always on** (`min=max=1`). All batch state lives in process
   memory; a second instance or serverless/scale-to-zero deploy silently breaks polling,
   retry and media purge. The app logs this constraint at startup.
2. **Internal network reachability only** (or, failing that, an unguessable hostname —
   `X-Robots-Tag: noindex` is already set on every route). Never a public URL: no auth exists.
3. **No reachable internal services / cloud metadata endpoint blocked** from the container's
   network. URL validation blocks SSRF at submit time, but yt-dlp follows platform redirects
   itself — the deploy environment is the second line of defence (threat #1 residual).
4. `OPENAI_API_KEY` from the host's secret store. Boot fails loudly in production if it is
   missing (unless `MOCK_PROVIDERS=1`). It is never logged (logger redacts key-like fields).

### Environment knobs (all optional)

| Var | Default | Meaning |
|---|---|---|
| `MOCK_PROVIDERS` | unset | `1` = fixture fetcher/transcriber (offline demo/CI) |
| `OPENAI_API_KEY` | — | required in real mode |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | override for proxies |
| `ITT_TMP_DIR` | `/tmp/itt` | per-item temp media root (purged aggressively) |
| `YTDLP_PATH` / `FFMPEG_PATH` | `yt-dlp` / `ffmpeg` | binary paths |
| `ITT_MAX_URLS` | 50 | batch cap (PRD OPEN-2) |
| `ITT_MAX_DURATION_SEC` | 900 | 15-min post cap (PRD OPEN-4) |
| `ITT_POOL_CONCURRENCY` | 4 | global worker pool size |
| `ITT_MAX_LIVE_BATCHES` | 3 | backpressure: further submits get 429 |
| `ITT_FAILED_AUDIO_RETENTION_MS` | 3600000 | failed-audio retry window (arch §8) |

### Operations

- Logs are JSON lines on stdout (NFR-6): per item — URL, platform, step timings, final
  status, `costUsd`, and on failure the mapped code plus raw yt-dlp/OpenAI detail.
  Raw detail never reaches the UI or the API.
- `/api/health`: tmp writable, key present, `yt-dlp --version`.
- **`extractor_error` spiking in logs = a platform changed something; rebuild the image**
  to pull a newer yt-dlp (expect roughly monthly; ~0.5 d/month maintenance budget, ADR-001).

## Launch checklist (for the release-manager — release gate blockers)

- **LB-01 — fetch + transcription spike (deferred from M0; ADR-001 thresholds apply).**
  The build sandbox had no platform/OpenAI access, so this MUST run from the real deploy
  environment before launch. Runbook (executable by a non-engineer):
  1. Deploy the container (real mode) per this README, or run locally with a real key.
  2. Collect 15 recent public post URLs from the requester — 5 YouTube, 5 TikTok,
     5 Instagram, including at least 3 non-English posts (tracked as Q-005).
  3. Paste each platform's 5 URLs as one batch; record per-platform success counts.
     **Pass: YouTube ≥5/5, TikTok ≥4/5, Instagram ≥3/5** — all without cookies.
  4. For 3 fetched non-English posts: confirm the card shows a detected language (not
     "auto-detected" — if "auto-detected" appears, RK-6 fired; the fallback is cosmetic
     but record it) and an English transcript; the requester rates each usable/not.
  5. Record per-post wall-clock (card submit → done) vs NFR-1 (≤3 min post in ≤3 min,
     ≤15 min post in ≤10 min) and the `costUsd` log lines vs the §11 cost model.
  6. Any threshold missed → apply the ADR-001 fallback ladder via the orchestrator
     (cookies / manual-upload PRD change / drop platform). Do not ship around it silently.
- **LB-02 — first real `docker build` + boot.** The Dockerfile is **unverified**: the build
  sandbox had no Docker daemon. Verify: image builds, `/api/health` is green in real mode,
  one URL end-to-end, then `docker logs` shows `media_purged` and `costUsd`.
- **NFR-3 accuracy check:** requester rates transcripts of 10 real posts across the
  priority languages (Q-001); ≥8/10 usable = pass. If failed: ADR-002 upgrade path
  (`gpt-4o-transcribe` + translation step, ~half-day).
- **NFR-4 reachability check:** confirm the deployed URL is unreachable from outside the
  internal network (or unguessable + noindex), and that the cloud metadata endpoint is
  blocked from the container.
- **Stderr taxonomy recalibration (RK-7):** during LB-01, diff real yt-dlp failures against
  `lib/taxonomy.ts`; `unknown` codes in logs are the signal to extend the rules.

## Where the bodies are buried

- `lib/registry.ts` — ALL state. A `Map` on a `globalThis` symbol. This is why one instance only.
- `lib/validation.ts` — the entire SSRF/command-injection defence (exact-match hostname
  allowlist + per-platform post-path patterns). Changes here must re-run
  `lib/__tests__/validation.test.ts` (the adversarial suite).
- `lib/taxonomy.ts` — stderr→reason mapping, calibrated from *documented* strings, not live
  failures (RK-7). Expect a second pass after LB-01.
- `lib/pipeline.ts` — the purge-before-terminal-status invariant lives in comments there;
  do not reorder it.
- Fixture audio is a few KB of generated bytes, never parsed — transcripts in mock mode are
  canned text keyed off the URL hash.
