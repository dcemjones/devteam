# Build Log — Influencer Transcript Translator

**Engineer:** implementation-engineer (Stage 7)
**Code location:** `/src` (standalone Next.js + TypeScript app, own package.json/lockfile — zero imports across the root-app boundary)
**Date started:** 2026-06-10

---

## M0 — Fetch spike: NOT EXECUTED, converted to LB-01 (per delivery plan §1 contingency)

- **T-001 / T-002: DEFERRED.** This build sandbox cannot reach Instagram/TikTok/YouTube and has no `OPENAI_API_KEY`. Per the delivery plan's sandbox contingency (and RK-5), the spike converts **unchanged in content and thresholds** into launch-blocking checklist item **LB-01**, executed by the user from the real deployment environment. Runbook delivered in T-404 (M4).
- Build proceeds against the T-102 provider interfaces with a deterministic fixture mode (`MOCK_PROVIDERS=1`).
- Consequences accepted and visible: stderr→taxonomy mapping (T-202) is calibrated from documented yt-dlp error strings, not live failures (RK-7); NFR-1 wall-clock timings, the 64 kbps <25 MB assumption, and the `verbose_json` detected-language assumption (RK-6) are all **NOT VERIFIED — deferred to LB-01**.

---

## M1 — Walking skeleton (T-101, T-102, T-103, T-104, T-105)

**Built:**
- **T-101 scaffold:** standalone Next.js 15 (App Router) + TS app in `/src`; own `package.json` + `package-lock.json`; `outputFileTracingRoot` pinned to `/src` so the root app's lockfile is never consulted; `output: "standalone"` for Docker; `X-Robots-Tag: noindex, nofollow` on every route; `/api/health` (tmp writable, key present, yt-dlp `--version`; key/binary checks reported-but-skipped in mock mode); `instrumentation.ts` → `lib/boot.ts` logs the single-instance constraint at startup and starts the sweeper. Dockerfile lands in M4 (T-404 hardening) — noted, not silent.
- **T-102 provider interfaces:** `Fetcher`/`Transcriber` interfaces with real + fixture implementations each, selected by `MOCK_PROVIDERS=1`.
  - Real fetcher: `yt-dlp` via `child_process.spawn` with **argv arrays, shell never enabled, `--` before the URL** (threat #2). Two-phase: `-J` metadata first (rejects >15-min posts *before* downloading, with exact duration for the card copy), then `-x --audio-format m4a --audio-quality 64K --max-filesize 200M`. Implementation decision: arch §4 shows a single invocation; two-phase honours "parse duration from metadata; reject >15 min" most directly at the cost of one extra platform request per item — recorded here, not silent.
  - Real transcriber: `POST {OPENAI_BASE_URL}/audio/translations`, `whisper-1`, `verbose_json`, 120 s timeout, 2 jittered in-step retries on 429/5xx/network (arch §9). Key from env only, never logged (logger redacts key-like fields).
  - Fixture mode: URL-marker-driven scenarios (`private`, `geoblock`, `loginwall`, `ratelimit`, `extractor`, `toolong`, `silent`, `english`, `sttflaky`, `sttfail`, `flakyfetch`); writes real dummy files to the per-item tmp dir so purge/retention logic is exercised for real; canned `verbose_json`-shaped responses. Instead of committed binary media assets, fixtures generate a few KB of deterministic bytes at runtime — nothing ever parses the audio in mock mode. (Deviation from the plan's "sample media files committed as test assets": equivalent coverage, no binary blobs in git.)
- **T-103 step machine:** FETCH → EXTRACT → TRANSCRIBE_TRANSLATE → DONE; per-item tmp dir `/tmp/itt/<batchId>/<itemId>/`; JSON-line logs with step timings; `costUsd = ceil(durationMin) × 0.006` (NFR-9); purge on completion (NFR-7). **Invariant added after catching a race in test:** media purge happens *before* the item flips to a terminal status, so nothing can ever observe a settled item with media still on disk.
- **T-104 registry + API:** in-memory `Map` on a `globalThis` symbol (survives route-chunk isolation; the single-instance constraint of ADR-003), 24 h TTL eviction; `POST /api/batches` (202, all-or-nothing validation, 400 with per-line errors, 400 `Maximum 50 URLs per batch`, 429 backpressure at 3 live batches); `GET /api/batches/:id` strips `audioPath`/`failedAt`; 404 carries "This batch is no longer available — please resubmit" (RK-4 accepted behaviour).
- **T-105 one page:** input panel (label "Post URLs", helper text, counter "n of 50", "Get transcripts" disabled when empty/over-limit), collapsed panel during processing, result cards per experience-spec §5 anatomy, 2 s polling that stops when settled, visually-hidden `aria-live="polite"` region announcing per-card transitions and batch completion. All microcopy verbatim from spec §6.

**Decisions within scope:**
- `www.youtube.com` added to the hostname allowlist. Arch §10's exact list includes `m.youtube.com` but omits `www.youtube.com` — treated as an editorial slip (rejecting the canonical YouTube URL would fail ST-01's happy path). **Deviation, recorded here**; allowlist remains exact-match only.
- URL validation goes beyond hostname allowlist to per-platform post-path patterns (e.g. `youtube.com/redirect?...` is rejected even though the host is allowlisted) — closes the open-redirect-endpoint corner of threat #1.
- UI components (ResultCard, page) were written feature-complete where churn would otherwise be high: the failed-card variants (T-204), summary bar/confirm (T-303), copy/collapse (T-401/T-403) exist in the M1 commit. Their acceptance tests land in their own milestones; ticket completion is claimed at test time, not file-creation time.
- Server-side batch validation (T-201 logic) shipped inside `lib/validation.ts` in M1 because `POST /api/batches` needs it; the adversarial security test suite lands in M2 with T-201.

**Test results (M1):**
```
Test Files  4 passed (4)
Tests  34 passed (34)
```
`tsc --noEmit` clean. `next build` succeeds. Live smoke against `next start` in mock mode: `/api/health` 200, single YouTube URL → done card with Spanish transcript + `costUsd: 0.024` + step timings in JSON logs + `media_purged` + `batch_settled`, `X-Robots-Tag: noindex, nofollow` present, startup constraint line logged.

**NOT verified (carried to LB-01):** live yt-dlp fetch, real whisper-1 call, real stderr taxonomy, NFR-1 timings, `verbose_json.language` on `/translations`.

**NFR mapping:** NFR-4 (noindex header; no-auth by design), NFR-6 (JSON logs verified in smoke), NFR-7 (purge verified by test + smoke), NFR-9 (costUsd verified by test + smoke).

**Self-review vs DoD:** criteria 1–5, 8 met for M1 tickets; criterion 7 (docker build) deferred to M4/T-404 — no Docker daemon in this sandbox, will be recorded honestly.

---

## M2 — Three platforms + failure states (T-201, T-202, T-203, T-204)

*Resumed after an interruption: two in-progress untracked files (the retry route and the adversarial validation test suite) were reviewed, found complete and consistent with the M1 conventions, and folded in unchanged.*

**Built / completed:**
- **T-201:** validation logic shipped in M1 (`lib/validation.ts`); this milestone lands the adversarial security test suite (`lib/__tests__/validation.test.ts`): userinfo smuggling, lookalike/suffix domains, IP literals incl. decimal/hex encodings and IPv6, scheme games (`javascript:`, `file:`), open-redirect endpoints on allowlisted hosts, explicit ports, garbage input — every rejection asserted to carry the exact ST-01 message. The file also pins the T-301 batch logic (cap/all-or-nothing/dedupe) since it lives in the same module; T-301 is claimed in M3.
- **T-202:** taxonomy mapping tests (`taxonomy.test.ts`) pin documented yt-dlp error strings → codes, including ordering (429 before login-wall) and the `unknown` default (RK-7). Real-provider boundary tests (`providers.real.test.ts`): RealFetcher with mocked spawn — two-phase invocation, `--`-before-URL argv hygiene (threat #2), >15-min rejection *before* download with exact duration, stderr mapping on both phases, timeout, exit-0-but-no-file; RealTranscriber with mocked fetch — form fields, bearer key, 429/5xx in-step retries with backoff, non-retryable 4xx fails fast, 120 s abort, missing-key fail-fast; ffmpeg re-encode safety net (threshold pass-through, mono-48k re-encode, original removed).
- **T-203:** retry endpoint `POST /api/batches/:id/items/:itemId/retry` (202 + `fromStep` / 409 not-failed / 404 with the resubmit message). Tests prove the QA log check directly: a TRANSCRIBE failure retries with `fetchAttempts === 1` (FETCH never repeated); artifact purged → transparent restart from FETCH; sweeper tests cover the 60-min failed-audio window (time injected), 24 h TTL eviction, and orphan-dir removal that never touches live retained audio.
- **T-204:** logic + UI shipped in M1; acceptance now covered by tests — no-speech → completed (pipeline.test), English label + failed-card variants with exact microcopy (ui.smoke.test), in-step provider retries (providers.real.test). All five fetch-failure variants verified end-to-end through the fixture pipeline across all three platforms (retry.test).

**Decisions within scope:** none beyond M1's recorded ones. No new deviations.

**Test results (M2):**
```
Test Files  9 passed (9)
Tests  92 passed (92)
```
`tsc --noEmit` clean. `next build` succeeds.

**NOT verified (carried to LB-01):** real yt-dlp stderr (taxonomy calibrated from documented strings — RK-7), live fetch/transcription, NFR-1 wall-clock.

**NFR mapping:** NFR-6 (raw stderr to logs only — asserted by API-leak test), NFR-7 (retention window + sweeper tested), threat #1/#2 (adversarial suite + argv tests).

**For QA:** the retry-never-refetches proof is `lib/__tests__/retry.test.ts` ("retries WITHOUT refetching"); the SSRF surface is wholly in `lib/validation.ts` — any change there must re-run the adversarial suite.
