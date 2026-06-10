# PRD — Influencer Transcript Translator (v1)

**Status:** Draft — awaiting Definition gate
**Date:** 2026-06-10
**Mode:** Fast-track (covers stages 1–3 in one pass)
**Inputs:** `/product/00-intake/request-brief.md`

## Executive summary
A brand/compliance user pastes one or many Instagram, TikTok, or YouTube post URLs and gets back, per post, a readable English transcript of the spoken audio (source language auto-detected, transcribed, translated). The transcript is the product; guideline checking stays human. Appetite is ≤1 week, so v1 is a walking skeleton — URL in, English transcript out, in the browser — plus small batches and CSV export. No accounts, no monitoring, no compliance automation.
**Success metric:** the user can produce a usable English transcript for ≥80% of valid public post URLs they submit, without engineering help, measured over the first 50 real submissions after launch.

---

## 1. Problem framing (condensed discovery + strategy)

### Problem statement
Influencers post in markets and languages the brand team does not speak. The team is accountable for what those influencers say but cannot read it. Today the check requires a native speaker or a manual chain of tools (download video, extract audio, transcribe, translate) — slow, error-prone, and skipped under time pressure. Posts go unchecked.

### Primary actor and job-to-be-done
**Actor:** brand/marketing/compliance person managing influencer campaigns across multiple markets (internal user, small team — ASSUMPTION carried from intake).
**JTBD:** *When an influencer publishes a post in a language I don't speak, I want to read in English what they actually said, so I can judge whether it follows our brand guidelines.*

### Riskiest assumptions
| # | Assumption | Cheapest test |
|---|---|---|
| A1 | ASSUMPTION: public post media can be fetched reliably from all three platforms via URL (e.g. yt-dlp or equivalent) despite platform ToS and anti-scraping measures. | Day-1 spike: fetch 5 real posts per platform with the candidate tool; record success rate. This is the kill-risk — surface result at the Architecture gate. |
| A2 | ASSUMPTION: off-the-shelf speech-to-text + translation (e.g. Whisper-class model + MT) yields transcripts "readable enough to judge adherence" for the languages that matter. | Same spike: run 3 real influencer posts through the pipeline, have the requester rate each transcript usable / not usable. |
| A3 | ASSUMPTION: batch sizes are tens of URLs, not thousands (≤50 per batch). | Ask the requester (OPEN-2 below); proceed on ≤50 until answered. |
| A4 | ASSUMPTION: no auth is acceptable for v1 (internal network / trusted users only). | One-line confirmation from requester; flag in OPEN list. |
| A5 | ASSUMPTION: per-transcript cost (fetch + STT + translation API calls) is acceptable at expected volume. | Compute cost for one 60s post during the spike; multiply by assumed monthly volume; show the number at the Architecture gate. |

---

## 2. Scope

### Doing (v1)
- Paste a single post URL (Instagram, TikTok, YouTube) → English transcript.
- Paste/upload a list of up to 50 URLs in one batch.
- Per-post result card: source URL, platform, detected source language, English transcript, status.
- Clear failure states per URL (unfetchable, no speech, unsupported platform) without killing the batch.
- Copy-to-clipboard per transcript; export batch results as CSV.
- Single-page web UI, no login.

### Not doing (v1)
- Automated guideline checking, flagging, or scoring.
- Scheduled monitoring / auto-ingestion of influencer accounts.
- OCR of on-screen text, caption analysis, visual/image compliance.
- User accounts, roles, team management, audit trails.
- Persistent history across sessions / searchable archive.
- Side-by-side source-language transcript display.
- Editing or correcting transcripts in-app.
- Speaker diarisation, timestamps, subtitles export.
- Any platform beyond Instagram, TikTok, YouTube.
- Mobile-optimised UI (desktop browser only).

### Release slices
**v0 — walking skeleton (build first):** one URL pasted → media fetched → audio extracted → language auto-detected → transcribed → translated → English transcript shown on screen with the source URL. One platform working end-to-end (YouTube first — most reliable fetch path, ASSUMPTION) is acceptable mid-week checkpoint; all three by v0 done.

**v1 — lovable (ship this):** v0 plus batch input (≤50 URLs), per-URL status/failure handling, detected-language label, copy + CSV export.

**Later (parked):** session history and re-run; source-language transcript alongside English; timestamps; account monitoring; auth; on-screen-text OCR. Parked because none are needed to do the core job once, and the appetite is one week.

**Cut-first order if the week runs out:** 1) CSV export → 2) batch input (single URL only) → 3) third platform (ship with two). The single-URL transcript path is never cut.

---

## 3. User stories

### ST-01 — Submit a single URL
*As a* brand compliance user, *I want* to paste one post URL and get an English transcript, *so that* I can check what the influencer said.

```gherkin
# Happy path
Given the input page is open
When I paste a valid public YouTube, TikTok, or Instagram post URL and submit
Then I see a processing indicator for that URL
And within the turnaround target (NFR-1) I see a result card containing
  the source URL, the platform, the detected source language, and the English transcript

# First-run / empty state
Given I open the app for the first time
Then I see an empty input box, a one-line instruction
  ("Paste Instagram, TikTok or YouTube post URLs, one per line"), and a submit button
And no result cards

# Most likely failure — invalid input
Given the input page is open
When I submit text that is not a URL or is a URL from an unsupported site
Then I see an inline error naming the problem ("Not a supported post URL — use Instagram, TikTok or YouTube")
And nothing is sent for processing
```

### ST-02 — Submit a batch
*As a* brand compliance user, *I want* to submit many URLs at once, *so that* I can review a whole campaign without pasting one at a time.

```gherkin
# Happy path
Given the input page is open
When I paste up to 50 URLs (one per line) and submit
Then each URL gets its own result card with an individual status (queued / processing / done / failed)
And cards update independently as each post finishes

# Most likely failure — partial batch failure
Given I submitted a batch of 10 URLs and 2 cannot be processed
When processing completes
Then 8 cards show transcripts and 2 cards show a failure reason
And the batch summary line reads "8 of 10 succeeded"
And the 8 successes are unaffected by the 2 failures

# Limit exceeded
Given the input page is open
When I paste more than 50 URLs and submit
Then I see "Maximum 50 URLs per batch" and nothing is processed
And my pasted input is preserved so I can trim it

# Duplicates
Given my pasted list contains the same URL twice
When I submit
Then the duplicate is processed once and shown once, with a note "duplicate removed"
```

### ST-03 — View per-post results
*As a* brand compliance user, *I want* each result tied clearly to its source post, *so that* I can trust which transcript belongs to which influencer post and take the text into my review notes.

```gherkin
# Happy path
Given a post has finished processing
Then its result card shows: the source URL as a clickable link, the platform name,
  the detected source language (human-readable, e.g. "Portuguese (Brazil)"),
  the audio duration, and the full English transcript as plain text
And a "Copy transcript" button copies the transcript text to the clipboard

# Export
Given a batch has finished (any mix of success and failure)
When I click "Export CSV"
Then I download a CSV with columns: url, platform, status, detected_language, transcript, error
And failed rows have status "failed" and a populated error column

# Empty transcript edge
Given a post's audio was processed but produced an empty transcript
Then the card shows status "No speech detected" rather than a blank transcript

# English-source post
Given the detected source language is English
Then the transcript is shown as-is and labelled "English (no translation applied)"
```

### ST-04 — Failure handling
*As a* brand compliance user, *I want* a plain-language reason when a post cannot be transcribed, *so that* I know whether to retry, find the post another way, or escalate.

```gherkin
# Unfetchable URL (private, deleted, geo-blocked, or platform refused)
Given I submit a URL whose media cannot be downloaded
Then its card shows status "Couldn't fetch this post" with the best-known reason
  (e.g. "post is private or removed") and a "Retry" action
And the failure is recorded in logs with the underlying error (NFR-6)

# No speech audio (music-only or silent post)
Given I submit a post whose audio contains no detectable speech
Then its card shows "No speech detected in this post's audio"
And it is counted as completed, not failed, in the batch summary

# Unsupported platform
Given I submit a URL from a site other than Instagram, TikTok, or YouTube
Then it is rejected at input with "Unsupported platform" before any processing

# Transient provider failure
Given the speech-to-text or translation provider returns an error
When I click "Retry" on that card
Then the post is reprocessed from the failed step without resubmitting the whole batch
```

**Traceability:** all four stories serve the single intake job ("read in English what an influencer said, per post URL") and the intake definition of good-enough. No orphan features.

---

## 4. Non-functional requirements

| # | Requirement | Threshold |
|---|---|---|
| NFR-1 | Turnaround, single post | A post ≤3 min long returns a transcript in ≤3 minutes wall-clock. ASSUMPTION: most influencer posts are ≤3 min; posts up to 15 min must complete in ≤10 min; longer posts are rejected with "Post too long for v1 (max 15 min)". |
| NFR-2 | Batch size | ≤50 URLs per batch (ASSUMPTION, pending OPEN-2). Batch of 50 short posts completes in ≤30 min; URLs may process concurrently. |
| NFR-3 | Accuracy bar | "Readable enough to judge guideline adherence." Verified before launch: requester reviews transcripts of 10 real posts across the priority languages (OPEN-1) and rates each usable/unusable; ≥8/10 usable = pass. No WER target in v1. |
| NFR-4 | Access | No auth in v1 (ASSUMPTION A4). Must be deployable so it is reachable only by the internal team (internal network or unguessable URL). Not exposed as a public unauthenticated service. |
| NFR-5 | Concurrency / users | ≤5 concurrent users (ASSUMPTION: small team). No multi-tenancy. |
| NFR-6 | Logging | Every submission logged with timestamp, URL, status, processing duration, and error detail on failure — enough for an engineer to diagnose a failed URL from logs alone. No user PII collected. |
| NFR-7 | Data retention | Fetched media deleted after processing. Transcripts held in session/server memory or temp storage only; no durable database in v1 (ASSUMPTION — history is "Later"). |
| NFR-8 | Browser support | Latest Chrome and Edge on desktop. Basic keyboard operability and visible labels; full WCAG 2.2 AA audit deferred (internal tool, ASSUMPTION acceptable). |
| NFR-9 | Cost visibility | Log estimated provider cost per transcript so A5 can be checked after launch. |

---

## 5. Data & integration touchpoints

| Touchpoint | Read/Write | Owner / notes |
|---|---|---|
| Instagram, TikTok, YouTube public post media | Read (download audio) | Platforms own the content; fetching tool choice and ToS exposure is an Architecture-gate decision (Risk R1). Only public posts in scope. |
| Speech-to-text provider (with language auto-detect) | Send audio, receive transcript + language | Architect chooses; must support auto-detect across the OPEN-1 priority languages. Data-processing terms reviewed (influencer content is third-party content, not company PII). |
| Translation provider (X → English) | Send text, receive English | May be the same provider as STT (e.g. translate-mode STT) — architect's call. |
| Temp media storage | Write then delete | App-owned; purge on completion (NFR-7). |
| CSV export | Write to user's machine | User owns the file after download; no server copy kept. |
| Logs | Write | App-owned; retain 30 days (ASSUMPTION). |

## 6. Key risks (hand to architect)

| # | Risk | Why it matters | First move |
|---|---|---|---|
| R1 | Media fetching breaks or violates platform ToS — Instagram and TikTok actively resist scraping; fetch paths break without notice. | This is the kill-risk for the whole product. | Day-1 spike per A1; architect must state fetch approach per platform, ToS position, and expected breakage/maintenance cost in an ADR. |
| R2 | STT/translation provider choice — quality varies sharply by language; wrong choice fails the accuracy bar in exactly the markets that matter. | Accuracy is the product's only value. | Evaluate 2 candidate providers against real posts in the OPEN-1 priority languages before committing. |
| R3 | Cost per transcript — per-minute STT + translation fees compound at batch scale. | Could make the tool uneconomic at real volume. | Cost one real 60s post in the spike; project monthly cost at assumed volume (A5); log per-transcript cost (NFR-9). |

## 7. OPEN questions

- **OPEN-1 (carried from intake):** Which source markets/languages matter most? Drives provider choice (R2) and the accuracy verification set (NFR-3). **Decision-owner:** requester. **Needed by:** Architecture stage. **Working assumption:** major EU + LATAM + APAC languages with strong commercial STT support (Spanish, Portuguese, French, German, Japanese, Korean, Indonesian).
- **OPEN-2 (carried from intake):** Expected URLs per batch and batches per week? Drives batch limit (NFR-2) and cost projection (A5/R3). **Decision-owner:** requester. **Needed by:** Architecture stage. **Working assumption:** ≤50 URLs per batch, low tens of batches per month.
- **OPEN-3:** Is no-auth acceptable for v1 given the deployment environment (A4/NFR-4)? **Decision-owner:** requester. **Needed by:** before Build. **Working assumption:** yes, internal network access only.
- **OPEN-4:** Maximum post length worth supporting — is the 15-minute cap (NFR-1) acceptable, given YouTube posts can be long-form? **Decision-owner:** requester. **Needed by:** before Build. **Working assumption:** 15-minute cap stands for v1.
