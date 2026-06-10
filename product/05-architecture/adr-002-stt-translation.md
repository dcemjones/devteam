# ADR-002 — Speech-to-text and translation provider

**Status:** Proposed (Architecture gate)
**Date:** 2026-06-10

## Context

The pipeline needs: language auto-detect across the working-assumption language set (Spanish, Portuguese, French, German, Japanese, Korean, Indonesian — Q-001 open), transcription, and translation to English, meeting NFR-3 ("readable enough to judge guideline adherence", ≥8/10 usable in the pre-launch check) and NFR-1 timing, with per-transcript cost logging (NFR-9). Two credible shapes:

**Option A — OpenAI `whisper-1` via `/v1/audio/translations` (one call):** the translations endpoint takes audio in any of Whisper's supported languages and returns **English text directly** — transcription + translation in a single API call at the same audio rate. Verified pricing (2026-06): **$0.006 per audio-minute**, no separate translation fee. Auto-detects source language; 99+ languages claimed (~50+ with strong quality); 25 MB file limit (fine for ≤15-min posts at 64 kbps mono — verified in spike). Endpoint is `whisper-1`-only; OpenAI's newer `gpt-4o-transcribe` ($0.006/min) / `gpt-4o-mini-transcribe` ($0.003/min) are higher-accuracy but transcribe-only — they'd need a separate translation step.

**Option B — Google Cloud STT + Google Cloud Translation (two calls):** Chirp-model STT at ~**$0.016/min** (enhanced models $0.024/min) plus Translation NMT at **$20 per million characters**. A 60 s post (~1,000 chars, ASSUMPTION ~150–170 wpm) ≈ $0.016 + $0.02 = **~$0.036/min equivalent — roughly 6× Option A**, with two integrations, two failure modes, two retry paths, and a GCP project/IAM setup the week doesn't have room for. Strengths: per-language tuning, word timestamps, arguably stronger on some Asian languages (ASSUMPTION — unverified for our set).

Per-call comparison for the canonical 60 s post:

| | Option A (whisper-1 translations) | Option B (Google STT + MT) |
|---|---|---|
| API calls per post | 1 | 2 |
| Cost per 60 s post | **$0.006** | ~$0.036 |
| 50-URL batch, avg 90 s | **$0.45** | ~$2.70 |
| Monthly (30 batches) | **~$13.50** | ~$81 |
| Language auto-detect | Yes (built-in) | Yes (config) |
| Integration effort | One SDK call, one secret | Two services, GCP IAM |
| Source-language transcript available | No (English only) — PRD explicitly de-scopes it for v1 | Yes |

## Decision

**Option A: OpenAI `whisper-1` via `/v1/audio/translations`, `response_format=verbose_json`.** One integration, one secret, one failure mode, ~6× cheaper, and it collapses two pipeline steps into one — the right shape for a 1-week appetite. Detected-language label comes from the `verbose_json` response (ASSUMPTION the `language` field is populated on the translations endpoint as on transcriptions — spike verifies; fallback in architecture §4). English-source audio passes through unchanged and is labelled "English (no translation applied)". Empty output → `no_speech` status, not failure. Cost logged per item as `ceil(durationMin) × $0.006` (NFR-9).

**Named upgrade path if NFR-3's 10-post check fails for the languages that matter (after Q-001 is answered):** switch step 4 to `gpt-4o-transcribe` ($0.006/min, source-language transcript) + `gpt-4o-mini` text translation to English (pennies per post). Same vendor, same secret, ~half-day change because the step is isolated behind a single module interface. Only if *that* fails do we open Option B / per-language provider routing — which would be a scope conversation, not a patch.

## Consequences

- Lowest-cost, lowest-integration path; the whole provider surface is one HTTPS call, making ST-04's retry-from-step trivial.
- We give up the source-language transcript (can't show original text alongside English) — acceptable: PRD parks side-by-side display as "Later"; the upgrade path restores it if that feature is ever pulled forward.
- Quality ceiling is whisper-1's, which is older than OpenAI's newest STT models; we accept that pending the NFR-3 human check, with the upgrade path pre-named.
- Vendor concentration on OpenAI: an OpenAI outage stalls the pipeline (retryable failures, no data loss). Accepted for an internal tool.
- Whisper hallucination on music-heavy/silent audio is a known failure mode (ASSUMPTION based on widely reported behaviour) — the no-speech handling and the human reading the transcript are the mitigations; no automated confidence scoring in v1.
- Data terms: influencer audio is third-party public content, no company PII; OpenAI API data isn't used for training by default (per OpenAI's stated API policy). Flagged for the requester's awareness, not a blocker.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Google Cloud STT + Translation (Option B)** | ~6× cost, two integrations and a GCP setup inside a 1-week appetite, no NFR it uniquely satisfies *yet*. Reconsidered only via the upgrade path if accuracy fails per-language. |
| **`gpt-4o-transcribe` + LLM translation as the default** | Two calls instead of one with no evidence yet that whisper-1 fails NFR-3. Kept as the pre-named upgrade, not the default — don't pay for accuracy before the 10-post check says you need it. |
| **Self-hosted Whisper (open weights)** | GPU hosting and ops for a tool spending ~$14/month on managed STT is résumé-driven architecture. Volume would need to grow ~100× before the maths flips. |
| **Azure Speech / Deepgram / AssemblyAI** | Credible, but each is another vendor evaluation the week doesn't need; none offers the one-call transcribe+translate-to-English shape at lower cost. (Pricing not verified — ASSUMPTION they land between Options A and B.) |
