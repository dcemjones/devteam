# Architecture — Influencer Transcript Translator (v1)

**Status:** Draft — awaiting Architecture gate
**Date:** 2026-06-10
**Inputs:** `/product/00-intake/request-brief.md`, `/product/03-definition/prd.md` (gate-approved), `/product/questions.md` (Q-001..Q-004 open — this design proceeds on the PRD's stated working assumptions and flags where an answer would change the design)

## Executive summary
A single standalone Next.js (TypeScript) app under `/src`, deployed as one always-on container with `yt-dlp` and `ffmpeg` baked in. Submitted URLs become items in an in-memory batch; a small in-process worker pool runs each item through fetch → audio extract → one-call transcribe+translate (OpenAI `whisper-1` `/audio/translations`, $0.006/min). No database, no queue infrastructure, no auth — by requirement, not omission. Marginal cost ≈ $0.006 per audio-minute; projected ≈ $15–40/month all-in at assumed volume. The kill-risk is media fetching (ADR-001); a day-1 spike with defined pass thresholds gates everything else.

**Stack at a glance**

| Concern | Choice | Why |
|---|---|---|
| Runtime/framework | Next.js (App Router) + TypeScript, standalone app in `/src` | Team already runs Next.js (ADR-003) |
| Media fetch | `yt-dlp` CLI (audio-only) via child process | Only credible single tool for all 3 platforms (ADR-001) |
| Audio extract | `ffmpeg` (mostly delegated to `yt-dlp -x`) | Boring, ubiquitous |
| STT + translation | OpenAI `whisper-1` `/v1/audio/translations` — transcribe + translate-to-English in one call | One integration, $0.006/min (ADR-002) |
| State | In-process memory (Map of batches), TTL-evicted | NFR-7 forbids durable storage |
| Concurrency | In-process worker pool (e.g. `p-limit`), no external queue | ≤50 URLs, ≤5 users |
| Deployment | Single Docker container, exactly one always-on instance, internal network or unguessable URL | NFR-4/5; in-memory state requires one process |

---

## 1. Constraints

| Constraint | Source | Architectural consequence |
|---|---|---|
| ≤1 week build appetite | Intake | One deployable, no infrastructure beyond a container |
| No auth; internal-only reachability | NFR-4, Q-003 open | Network-level protection, not app-level; nothing in the app may assume identity |
| ≤5 concurrent users, ≤50 URLs/batch | NFR-2/5, Q-002 open | Single process is sufficient; no horizontal scaling |
| No durable DB; media purged after processing | NFR-7 | All job state in memory; temp files with aggressive cleanup; restart loses in-flight batches (accepted) |
| Repo root is a Next.js dashboard (workspace infra) | Intake context | Product lives in `/src` with its **own** `package.json`, lockfile, and deploy pipeline. Zero imports from, or into, the root app. |
| Team stack | Repo evidence | TypeScript/Next.js is the boring default (ADR-003) |
| Posts ≤15 min (reject longer) | NFR-1, Q-004 open | Caps file size (whisper 25 MB limit) and cost ceiling |

**Innovation-token ledger:** one token spent on `yt-dlp` — there is no boring alternative that fetches from all three platforms. Everything else is stock.

---

## 2. C4 context (words)

**System:** Influencer Transcript Translator (ITT) — internal web app.

**Actors:**
- *Compliance user* (≤5 people) — pastes URLs in a desktop browser, reads/copies transcripts, exports CSV.
- *Maintaining engineer* — reads logs to diagnose failed URLs (NFR-6); updates `yt-dlp` when extractors break.

**External systems:**
- *Instagram / TikTok / YouTube CDNs* — ITT downloads public post media (read-only, unauthenticated). Adversarial dependency: no contract, actively resists automated access (ADR-001).
- *OpenAI API* — ITT sends audio files, receives English text + detected language. Paid, contractual, rate-limited.

```
 Compliance user ──browser──▶ ┌─────────────────────────┐
 Maintaining engineer ─logs─▶ │  ITT (this system)      │
                              └─────┬──────────┬────────┘
                       yt-dlp HTTPS │          │ HTTPS + API key
                                    ▼          ▼
                     IG / TikTok / YouTube   OpenAI API
                     (public media, no auth) (/audio/translations)
```

## 3. C4 container (words)

One deployable: a **Next.js app running as a single long-lived Node process** inside a Docker container that also contains the `yt-dlp` and `ffmpeg` binaries. Internally three responsibilities, not three deployables:

1. **Web UI** — single page (React, server-rendered shell): URL textarea, submit, result cards, CSV export. Polls the API every ~2 s while a batch is live (boring; SSE not needed at this scale).
2. **API layer** — Next.js route handlers under `/api/*` (surface in §6). Validates input, owns the batch registry, serves state and CSV.
3. **Pipeline workers** — in-process module started per batch: a worker pool (concurrency ~4, see §5) pulls items and runs the step machine in §4, shelling out to `yt-dlp`/`ffmpeg` via `spawn` (argument array, never a shell string) and calling OpenAI over HTTPS.

**Datastores:** none durable. (a) In-memory batch registry — a `Map<batchId, Batch>` with TTL eviction (24 h or memory pressure). (b) Per-item temp directory `/tmp/itt/<batchId>/<itemId>/` for downloaded audio — purged per NFR-7 (§8). Logs go to stdout as JSON lines; the host platform retains them ~30 days (PRD assumption).

---

## 4. Processing pipeline (component view)

Per-item state machine. Each step records start/end time, and on failure records `{step, code, message, retryable}` so retry can resume *from the failed step* (ST-04).

| Step | Does | Failure modes → user-facing status |
|---|---|---|
| **1. VALIDATE** (synchronous, at submit) | Parse URL; normalise; check host against platform allowlist (§7); dedupe within batch; enforce ≤50 | "Not a supported post URL", "Maximum 50 URLs per batch", "duplicate removed". Rejected items never enter the pipeline. |
| **2. FETCH** | `yt-dlp -x --audio-format m4a --audio-quality 64K -o <tmpdir>/audio.m4a --no-playlist --max-filesize 200M <url>`; parse duration from metadata; reject >15 min ("Post too long for v1 (max 15 min)") | Private/removed/geo-blocked/extractor broken → "Couldn't fetch this post" + best-known reason mapped from yt-dlp stderr. Retryable. |
| **3. EXTRACT** | Mostly done by `yt-dlp -x` (ffmpeg post-processor). Safety net: if output >24 MB, re-encode mono 48 kbps with `ffmpeg` to stay under whisper's 25 MB cap. ASSUMPTION: 64 kbps mono m4a keeps a 15-min post ≈ 7 MB — verify in spike. | Corrupt media → "Couldn't process this post's audio". Retryable (re-runs from FETCH if file gone). |
| **4. TRANSCRIBE_TRANSLATE** | One call: OpenAI `POST /v1/audio/translations`, model `whisper-1`, `response_format=verbose_json` → English text + detected source language + duration. If detected language is English, label "English (no translation applied)". Empty/whitespace text → status `no_speech` ("No speech detected"), counted as completed not failed. | Provider 4xx/5xx/rate-limit → retry with backoff ×2 in-step, then "Transcription service error — Retry". Retryable from this step *without refetching* (audio kept briefly, §8). |
| **5. DONE** | Result card populated; compute `costUsd = ceil(durationMin) × 0.006` and log it (NFR-9); purge temp dir (NFR-7). | — |

ASSUMPTION: `verbose_json` on the `/translations` endpoint returns the detected source `language` field as it does on `/transcriptions`. Verify in the day-1 spike; fallback is one cheap `gpt-4o-mini` call to label the language from the source audio's transcription metadata, or display "auto-detected".

**Retry-from-step design (ST-04):** each item stores `lastCompletedStep` and surviving artifacts (`audioPath`, `durationSec`). `POST .../retry` re-enqueues the item starting at `failedStep`. If the needed artifact was already purged (TTL expired, §8), retry transparently restarts from FETCH. Retries enter the same worker pool; no special path.

## 5. Job/queue model

- **Batch** = one submission (1–50 items). Created synchronously; processing is fire-and-forget into the in-process pool; UI polls.
- **Worker pool:** global concurrency limit of **4 items in-flight** across all batches (fair FIFO across batches so one user's 50-URL batch doesn't starve another's single URL — small per-batch round-robin). Within an item, steps are sequential.
- **Why 4:** fetch is network-bound (~10–40 s/post, ASSUMPTION), whisper processes faster than real time (ASSUMPTION ~0.2–0.5× duration). 50 posts × ~90 s avg ÷ 4 workers ≈ 12–19 min, inside NFR-2's 30-min budget with slack; 4 concurrent `yt-dlp` processes keeps per-platform request rate low (reduces IP-block risk, ADR-001) and memory bounded. Tune after the spike.
- **No external queue/Redis:** at ≤50 items and ≤5 users an in-process array + `p-limit` is the whole queue. A crash loses in-flight batches; user resubmits. Accepted consequence of NFR-7's no-durable-storage stance — stated at the gate.
- **Backpressure:** max 3 live batches server-wide; further submissions get HTTP 429 "Server busy — try again in a few minutes".

## 6. Data model (in-memory shapes)

```ts
type Platform = "youtube" | "tiktok" | "instagram";
type Step = "FETCH" | "EXTRACT" | "TRANSCRIBE_TRANSLATE";
type ItemStatus = "queued" | "fetching" | "extracting" | "transcribing"
                | "done" | "no_speech" | "failed";

interface Batch {
  id: string;                 // crypto-random, unguessable (it IS the access token, NFR-4)
  createdAt: string;
  items: Item[];
  rejected: { url: string; reason: string }[];   // failed VALIDATE
  duplicatesRemoved: number;
  expiresAt: string;          // TTL eviction, 24 h
}

interface Item {
  id: string;
  url: string;                // as submitted
  normalizedUrl: string;
  platform: Platform;
  status: ItemStatus;
  lastCompletedStep?: Step;
  audioPath?: string;         // temp file; null after purge
  durationSec?: number;
  detectedLanguage?: string;  // human-readable, e.g. "Portuguese"
  transcript?: string;        // English
  error?: { step: Step; code: string; message: string; retryable: boolean };
  costUsd?: number;           // NFR-9
  timings: Partial<Record<Step, { startedAt: string; endedAt?: string }>>;
}
```

**Classification:** transcripts are third-party public content, not company PII; URLs may reveal campaign targets (mildly sensitive — why NFR-4 forbids public exposure). No user PII collected (NFR-6). Source of truth for everything here is "this process's memory" — there is no second copy anywhere, by design.

## 7. API surface (UI ↔ server)

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/batches` | POST | `{ urls: string[] }` | 202 `{ batchId, items: [{id,url,platform,status}], rejected, duplicatesRemoved }`; 400 on >50 or empty; 429 on backpressure |
| `/api/batches/:id` | GET | — | 200 full `Batch` (minus `audioPath`); 404 if expired/unknown |
| `/api/batches/:id/items/:itemId/retry` | POST | — | 202 `{ status: "queued" }`; 409 if item not failed |
| `/api/batches/:id/export.csv` | GET | — | `text/csv`: `url,platform,status,detected_language,transcript,error` (ST-03) |

CSV cells beginning `= + - @ \t` are prefixed with `'` (CSV/formula-injection guard). Polling interval 2 s while any item is non-terminal; UI stops polling when batch settles.

## 8. Purge & retention (NFR-7)

- Temp dir per item; deleted immediately on `done` / `no_speech`.
- **Deliberate interpretation:** on `failed`, audio is kept up to **60 minutes** to honour ST-04's retry-from-failed-step without refetching, then a sweeper purges it. "After processing" is read as "after processing concludes, including the retry window". If the requester wants instant purge, retry simply degrades to refetch — one-line config change.
- Sweeper also runs at startup (clears orphans from crashes) and every 10 min.
- Batches evicted from memory at 24 h TTL; transcripts are gone after that or on restart (PRD: history is "Later").

## 9. Failure handling summary

- Per-item isolation: one failure never affects siblings (ST-02 partial-failure scenario).
- yt-dlp stderr mapped to a small reason taxonomy: `private_or_removed`, `geo_blocked`, `login_required`, `rate_limited`, `extractor_error`, `too_long`, `unknown` — shown in plain language, raw stderr goes to logs only (NFR-6).
- OpenAI calls: timeout 120 s, 2 retries with jittered backoff in-step; then surface as retryable failure.
- Whole-process crash: in-flight batches lost; UI poll gets 404 and shows "This batch is no longer available — please resubmit". Accepted (see §5).

## 10. Threat sketch (STRIDE, sized to an internal no-auth tool)

| # | Threat | STRIDE | Mitigation |
|---|---|---|---|
| 1 | **SSRF via user-supplied URLs** — attacker submits `http://169.254.169.254/...` or an internal host and the server fetches it. The big one for a URL-ingesting tool. | S/I | Strict **hostname allowlist** at VALIDATE (`youtube.com`, `youtu.be`, `m.youtube.com`, `instagram.com`, `www.instagram.com`, `tiktok.com`, `www.tiktok.com`, `vm.tiktok.com`, `vt.tiktok.com`); parse with `new URL()`, reject userinfo/IP-literal/non-https. Residual: platform redirects fetched *by yt-dlp* — mitigate by deploying the container with **no reachable internal services** and cloud-metadata endpoint blocked (host firewall / no GCP-AWS metadata role). Document as deploy requirement. |
| 2 | **Command injection into yt-dlp/ffmpeg** | E | `spawn` with argument arrays only — no shell, ever; URL passed as a single argv element after allowlist validation; `--` before the URL. |
| 3 | **Unguessable-URL leakage** → strangers reach an unauthenticated tool and spend our OpenAI budget / see campaign URLs | I/E/D | Prefer internal-network deployment over unguessable URL (recommendation to requester, Q-003); no search-engine indexing (`X-Robots-Tag`); batch IDs crypto-random; backpressure caps (§5) + 15-min post cap bound worst-case spend per abuser. |
| 4 | **Cost/DoS abuse** — 50×15-min posts in a loop | D | Hard caps: 50 URLs/batch, 3 live batches, 15-min post cap, `--max-filesize`, global worker limit. Worst case ≈ $4.50/batch (§11) — annoying, not ruinous. Per-transcript cost logging (NFR-9) makes abuse visible. |
| 5 | **Malicious/poisoned media** — crafted file exploits ffmpeg, or CSV formula injection on export | T/E | Keep ffmpeg current (rebuilt with container image); processing inside the container with no privileges or mounted secrets beyond the OpenAI key; CSV formula-prefix escaping (§7). Repudiation is explicitly not addressed: no auth → no attribution (NFR-4 accepted trade). |

## 11. Cost model (R3, NFR-9)

Verified pricing (2026-06): `whisper-1` `/audio/translations` **$0.006/audio-minute**, translation to English included — no separate MT fee. Fetch cost ≈ bandwidth only.

| Scenario | Maths | Cost |
|---|---|---|
| One 60 s post | 1 min × $0.006 | **$0.006** |
| 50-URL batch, avg 90 s (ASSUMPTION on avg length) | 75 min × $0.006 | **$0.45** |
| Monthly, 30 batches (Q-002 working assumption: "low tens") | 30 × $0.45 | **≈ $13.50** |
| Worst-case batch: 50 × 15-min posts | 750 min × $0.006 | $4.50 |
| Hosting: one small always-on container (1 vCPU / 1–2 GB) | provider-dependent | ASSUMPTION $10–25/mo |

**Projection: ≈ $25–40/month all-in at assumed volume.** A5 is comfortably satisfied unless volume is 50–100× the assumption. Per-item `costUsd` logged on completion satisfies NFR-9 and lets us check A5 with real numbers after launch.

## 12. Operability

- **Logs (NFR-6):** JSON lines to stdout. Per item: timestamp, batchId, itemId, URL, platform, step transitions with durations, final status, `costUsd`, and on failure the mapped code **plus raw yt-dlp/OpenAI error detail** — sufficient to diagnose a failed URL from logs alone. No user PII exists to log. Host retains ~30 days (ASSUMPTION per PRD).
- **Monitoring:** for v1, "an engineer reads the logs". One `/api/health` endpoint (checks tmp-dir writable, OpenAI key present, yt-dlp binary runs `--version`). No alerting stack — out of appetite.
- **Secrets:** single secret, `OPENAI_API_KEY`, via environment variable from the host's secret store. Never logged.
- **yt-dlp updates:** the dominant maintenance task (ADR-001). Container rebuild pulls latest yt-dlp; expect to rebuild on breakage, possibly monthly. Mapped error code `extractor_error` spiking in logs = time to rebuild.
- **Environments:** local dev (docker compose or `next dev` + local binaries) and prod. No staging — internal tool, 1-week appetite.

## 13. Deployment shape

Single Dockerfile in `/src`: `node:22-slim` + `ffmpeg` (apt) + `yt-dlp` (static binary, pinned with documented update path) + `next build` / `next start`. **Exactly one instance, always on** — in-memory state forbids horizontal scale and scale-to-zero (set min=max=1 on Cloud Run/Fly-type platforms, or one VM). Reachable only on the internal network, or failing that an unguessable hostname with robots-noindex (NFR-4; recommend internal network — see threat #3). Separate from the root dashboard app's deployment entirely.

## 14. NFR → mechanism map (completeness check)

| NFR | Mechanism | Status |
|---|---|---|
| NFR-1 turnaround | Worker starts immediately; whisper faster than real time; 15-min cap; per-step timeouts | Mapped (spike confirms timings) |
| NFR-2 batch ≤50 / ≤30 min | VALIDATE cap; pool of 4 ⇒ ~12–19 min for 50 short posts (§5) | Mapped |
| NFR-3 accuracy bar | ADR-002 provider choice + pre-launch 10-post usability check; upgrade path defined | Mapped (human check, not architecture, does the verifying) |
| NFR-4 access | Deploy-time network restriction; no public exposure; threat #3 | Mapped — **deploy requirement, blocked on Q-003 confirmation** |
| NFR-5 ≤5 users | Single process + backpressure caps | Mapped |
| NFR-6 logging | §12 structured logs | Mapped |
| NFR-7 retention | §8 purge + TTL + no DB | Mapped (60-min retry-window interpretation flagged) |
| NFR-8 browser | Plain React SPA, latest Chrome/Edge; keyboard-operable controls | Mapped (UX spec owns detail) |
| NFR-9 cost visibility | `costUsd` computed & logged per item; §11 model | Mapped |

No unmapped NFRs. Nothing in the PRD needed deleting; no route-backs raised.

## 15. Walking skeleton (build first)

**Slice:** one **YouTube** URL pasted in the deployed container → yt-dlp fetch → audio extract → `whisper-1` `/translations` → English transcript + detected language rendered on screen → temp file purged → cost line in logs.
**Proves:** the riskiest integration chain (external fetch → binary toolchain in container → paid API) end-to-end in the real deployment shape. Batch, retry, CSV, and the two hostile platforms layer on afterwards — exactly matching the PRD's v0/cut-first ordering.
**Gate inside the skeleton — the day-1 spike (A1/A2, defined in ADR-001):** must pass before any further build.

## 16. ADR index

| ADR | Title | Decision |
|---|---|---|
| [ADR-001](adr-001-media-fetching.md) | Media fetching | yt-dlp for all three platforms, with explicit ToS position, spike thresholds, and fallback ladder. **Kill-risk lives here.** |
| [ADR-002](adr-002-stt-translation.md) | STT + translation | OpenAI `whisper-1` `/audio/translations` one-call; Google STT+MT rejected; upgrade path named |
| [ADR-003](adr-003-stack.md) | Runtime/stack for `/src` | Standalone Next.js + TypeScript app, single always-on container |

## OPEN (user-blocking)

- **OPEN (Q-003, before Build):** confirm deployment environment supports internal-network-only reachability. The no-auth design is only safe behind that wall; if the answer is "public cloud URL only", we add basic-auth/one shared token (half-day, route back to PM for NFR-4 v2).
- **OPEN (Q-001, before NFR-3 check):** priority languages — does not change this architecture (whisper covers 99+ languages) but decides which 10 posts the accuracy pass uses, and whether the ADR-002 upgrade path triggers.
- **OPEN (Q-002):** if real volume is ~50× the working assumption, revisit cost projection (§11) and the single-instance pool size — nothing structural changes below ~500 URLs/day.
- **OPEN (Q-004):** 15-min cap is load-bearing for cost ceiling and whisper's 25 MB file limit; raising it past ~45 min forces audio chunking work not budgeted in the week.
- **OPEN (new):** ADR-001's ToS position needs the requester's explicit acceptance at the Architecture gate — business risk, not engineering risk.
