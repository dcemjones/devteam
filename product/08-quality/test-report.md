# Test Report — Influencer Transcript Translator (v1)

**Status:** Gate-ready (QA verdict below)
**Date:** 2026-06-11
**QA:** qa-engineer (Stage 8) — independent verification, fixture mode (`MOCK_PROVIDERS=1`)
**Inputs verified against:** `/product/03-definition/prd.md` (ST-01..04, NFR-1..9), `/product/04-design/experience-spec.md` (states + microcopy), `/product/06-plan/delivery-plan.md` §8 (QA handoff), `/product/07-build/build-log.md`

## Executive summary (5 lines)
1. **Verdict: GO-WITH-KNOWN-ISSUES.** No Blocker, no Major. The offline-verifiable scope is solid: I re-ran the suite (118/118), tsc clean, build clean, and independently exercised the running server.
2. Every ST-01..04 Gherkin criterion that can be tested offline is **covered and passing**; my own exploratory + adversarial probes found no spec violations.
3. The SSRF/command-injection defence — the one I was told to try to break — **held against all 22 of my probes** (userinfo smuggling, lookalikes, suffix domains, IP literals incl. hex/decimal/IPv6, ports, open-redirect endpoints, scheme games, punycode).
4. The known issues the user must accept are **not defects** — they are the planned LB-01 (live fetch/STT, NFR-1/2/3 timings & accuracy) and LB-02 (Docker build), correctly deferred per the delivery-plan sandbox contingency and visible in the README launch checklist.
5. Defects found: **0 Blocker, 0 Major, 3 Minor, 2 Trivial** — all cosmetic/spec-drift, none gate-blocking.

---

## 1. Build verification — actual numbers (re-run by QA, not quoted from build log)

| Check | Command | Result |
|---|---|---|
| Unit + integration tests | `npm test` | **118 passed (118), 15 files passed (15)**, 0 failed. Duration ~3.0 s. |
| Type check | `npx tsc --noEmit` | **exit 0, clean.** |
| Production build | `npm run build` | **Compiled successfully**, 7 routes incl. `export.csv`, exit 0. |
| Live smoke (mock mode) | `next start -p 3199` | `/api/health` → 200 `{ok:true, mockProviders:true}`; `X-Robots-Tag: noindex, nofollow` on `/` and API routes. |

Build-log claims (118 tests, tsc clean, build clean) are **confirmed accurate**.

---

## 2. Traceability matrix — every ST Gherkin criterion → coverage → result

Legend: PASS = verified by my own run (test + live probe); NV = NOT VERIFIED (live-network, deferred to LB-01).

### ST-01 — Submit a single URL
| Criterion | Coverage | Result |
|---|---|---|
| Happy: valid URL → processing indicator → result card (URL, platform, language, transcript) | `api.test.ts` settle-e2e + live: `fix-ok` → done card, Spanish, costUsd | PASS (transcript content is fixture; real STT = NV/LB-01) |
| First-run/empty state: empty box, helper text, submit, no cards | `ui.smoke.test.tsx` + rendered HTML (label "Post URLs", helper verbatim, disabled submit, no cards) | PASS |
| Invalid input: inline error "Not a supported post URL…", nothing processed | `validation.test.ts`, `ui.batch.test.tsx`, live mixed-batch probe | PASS |
| Turnaround target (NFR-1) | — | **NV — LB-01** (wall-clock needs live fetch/STT) |

### ST-02 — Submit a batch
| Criterion | Coverage | Result |
|---|---|---|
| Happy: up to 50 URLs, per-card status, cards update independently | `batch.test.ts`, `ui.batch.test.tsx`, live 9-item mixed batch | PASS |
| Partial failure: 8 transcripts + 2 failures, "8 of 10 succeeded", successes unaffected | `batch.test.ts` (10 w/ 2 fail), live (9-item: 3 done/no-speech vs 4 fail, isolated) | PASS |
| Limit exceeded: >50 → "Maximum 50 URLs per batch", nothing processed, input preserved | `validation.test.ts`, `ui.batch.test.tsx`, live 51-URL probe → 400 exact msg | PASS |
| Duplicates: processed once, "duplicate removed" note | `validation.test.ts` (normalised dedupe), live (`youtu.be/x` ≡ `watch?v=x` deduped, dup flag on survivor) | PASS |

### ST-03 — View per-post results
| Criterion | Coverage | Result |
|---|---|---|
| Done card: clickable URL, platform, human-readable language, duration, full transcript | `ui.smoke.test.tsx`, `ResultCard.tsx`, live | PASS |
| Copy transcript button copies to clipboard | `ui.actions.test.tsx` (clipboard write, "Copied" swap, full text when collapsed) | PASS |
| Export CSV: columns `url,platform,status,detected_language,transcript,error`; failed rows status `failed` + populated error | `csv.test.ts`, `export.test.ts`, live CSV download inspected | PASS — exact header, failed rows populated |
| Empty transcript edge → "No speech detected" not blank | `pipeline.test.ts`, live (`fix-silent` → `no_speech`, counted completed) | PASS |
| English-source → "English (no translation applied)" | `pipeline.test.ts`, `ui.smoke.test.tsx`, live (`fix-english` → English) | PASS |

### ST-04 — Failure handling
| Criterion | Coverage | Result |
|---|---|---|
| Unfetchable → "Couldn't fetch this post" + best reason + Retry; logged with underlying error (NFR-6) | `retry.test.ts`, `ui.smoke.test.tsx`, live (`fix-private` → private_or_removed; raw stderr in logs only) | PASS (fixture stderr; real taxonomy = NV/LB-01) |
| No speech → "No speech detected…", counted completed not failed | `pipeline.test.ts`, live | PASS |
| Unsupported platform → rejected at input before processing | `validation.test.ts`, live (example.com, IG login path, TikTok terms path all 400) | PASS |
| Transient provider failure → Retry reprocesses from failed step (no re-fetch) | `retry.test.ts` ("retries WITHOUT refetching"), live (`fix-sttflaky`: retry `fromStep:TRANSCRIBE_TRANSLATE` → done) | PASS |

**Orphan criteria with no coverage: none.** Every Gherkin line maps to at least one test or a live check, or is explicitly NV/LB-01.

---

## 3. Exploratory charters + findings

| Charter | Probe | Finding |
|---|---|---|
| **C1 — Input boundaries** | empty array, whitespace-only lines, 51 URLs, mixed valid/invalid, non-JSON body, wrong shape (`urls:"..."`), non-string array element, 5 MB single line | All handled correctly. Empty→400 `empty`; whitespace→`empty`; 51→400 exact cap msg; mixed→400 per-line errors with correct line numbers; non-JSON→400 "Request body must be JSON"; wrong shape→400 "Body must be { urls: string[] }"; 5 MB→400 invalid (not crash). |
| **C2 — Fixture failure markers** | private, geoblock, loginwall, ratelimit, extractor, toolong, silent, english, sttfail, sttflaky across all 3 platforms | All map to correct status + exact microcopy. `too_long` → "This post is 22 minutes. Shorter posts up to 15 minutes are supported." + no Retry. `no_speech` counted as completed. |
| **C3 — Duplicates** | `youtu.be/fix-ok-0001` + `watch?v=fix-ok-0001` in one batch | Deduped by normalised URL, 9 items from 10, `duplicateRemoved` flag on survivor, `duplicatesRemoved:1`. |
| **C4 — Retry** | retry a `sttflaky` failed item; retry a `done` item | Flaky retry resumed from `TRANSCRIBE_TRANSLATE` (not FETCH) → done. Retry on non-failed item → **409** "Item is not in a failed state". |
| **C5 — CSV content / escaping** | mixed batch CSV; transcript-starts-with-`=` unit test; comma/quote/newline cells | RFC-4180 quoting correct; formula-prefix guard (`= + - @ TAB`) prepends `'`; failed rows carry `code: message`; headers `text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="transcripts.csv"`. |
| **C6 — 404 / unknown batch** | GET unknown batch id; GET unknown export.csv | Both 404 with "This batch is no longer available — please resubmit" (RK-4 accepted behaviour). |
| **C7 — Concurrency / backpressure** | 3 live batches (40 items each) then a 4th | 4th → **429** "Server busy — try again in a few minutes". After the 3 drained (~19 s), a new batch → 202. Capacity recovery confirmed. |
| **C8 — Health endpoint** | GET /api/health in mock mode | 200, all checks ok, key/binary reported "skipped (mock mode)". |
| **C9 — Temp purge / retention (NFR-7)** | inspect `/tmp/itt` after a mixed batch | Successful + non-retryable (`too_long`) items leave no media. Only the **retryable failed** item retained one `audio.m4a` (the 60-min retry window, by design — arch §8). No settled-with-media leak observed. |

---

## 4. Security findings (SSRF was the target)

I ran the committed adversarial suite (`validation.test.ts`, 20 cases) **and** fired 22 of my own probes against the live `POST /api/batches`. **Every malicious URL was rejected with 400** before any processing:

| Attack class | Probe(s) | Result |
|---|---|---|
| Userinfo smuggling | `https://user:pass@www.youtube.com/...`, `https://www.youtube.com@evil.com/...` | Rejected (has_userinfo / unsupported_host) |
| Suffix / lookalike domains | `youtube.com.evil.com`, `evil-youtube.com`, `notyoutube.com` | Rejected (exact-match allowlist, no suffix logic) |
| Punycode lookalike | `www.xn--youtub-ova.com` | Rejected |
| IP literals | `192.168.1.1`, `127.0.0.1`, `169.254.169.254` (cloud metadata), `[::1]` | Rejected (ip_literal) |
| Encoded IPs | `0x7f000001`, `2130706433` | Rejected (numeric-host guard) |
| Scheme games | `javascript:alert(1)`, `file:///etc/passwd`, `http://` (non-https) | Rejected |
| Explicit ports | `www.youtube.com:8443` | Rejected (port→unsupported_host) |
| Open-redirect endpoints on allowlisted host | `youtube.com/redirect?q=…`, `attribution_link?u=…` | Rejected (per-platform post-path pattern, not just host) |
| Path traversal | `youtu.be/../../../etc/passwd` | Rejected (not a post path) |
| Non-JSON / oversized body | `not json`, 5 MB line | 400, no crash |
| CSV header injection / formula injection | `=`,`+`,`-`,`@`,TAB-prefixed cells; commas/quotes in transcript | Neutralised (apostrophe prefix + RFC-4180 quoting); filename is a fixed constant, not user-derived → no Content-Disposition injection surface |

**Verdict on SSRF defence: I could not break it within scope.** Defence-in-depth is correct: host allowlist is exact-match, plus a positive per-platform path pattern, plus userinfo/IP/scheme/port rejection. Note the residual: DNS rebinding (host resolves to a private IP at fetch time) is **not** defended in `validation.ts` — but it cannot be tested offline and only matters once the **real** fetcher runs; flag it for LB-01 hardening (see Defects, Minor-3).

---

## 5. NFR audit

| NFR | Requirement | Result | Note |
|---|---|---|---|
| NFR-1 | ≤3 min post in ≤3 min; ≤15 min in ≤10 min; >15 min rejected | **PARTIAL** | >15-min rejection verified (before download, in `providers.real.test.ts`; live `too_long` card verified). Wall-clock timing = **NV — LB-01** (needs live fetch/STT). |
| NFR-2 | ≤50/batch; 50 short posts ≤30 min; concurrent | **PARTIAL** | 50 cap + 4-way pool + FIFO fairness verified; 50-item fixture batch drains in budget. Real 30-min wall-clock = **NV — LB-01**. |
| NFR-3 | "Readable enough", ≥8/10 usable | **NV — user task** | Requester rates 10 real posts pre-launch; materials in T-404 README. |
| NFR-4 | No auth; reachable only by internal team; not public | **PARTIAL** | `X-Robots-Tag: noindex, nofollow` verified on all routes; no-auth by design. Actual network reachability = deploy-time check (LB-01/README NFR-4 item). |
| NFR-5 | ≤5 concurrent users; no multi-tenancy | **VERIFIED** | 4-worker pool + 3-live-batch backpressure (429) verified live. |
| NFR-6 | Every submission logged: timestamp, URL, status, duration, error detail; no PII | **VERIFIED** | JSON-line logs carry `batch_created`, `step_completed` (timings), `item_completed`, `item_failed` (raw stderr to logs only), `batch_settled`. No API key / bearer material in logs (grepped). |
| NFR-7 | Media deleted after processing; no durable DB | **VERIFIED** | Purge-before-terminal invariant; in-memory `Map` registry, 24 h TTL; only retryable-failed media retained for the 60-min window (by design). |
| NFR-8 | Chrome/Edge desktop; basic keyboard + labels | **VERIFIED (in scope)** | See accessibility below. Full WCAG audit deferred per NFR-8. |
| NFR-9 | Log estimated provider cost per transcript | **VERIFIED** | `costUsd = ceil(durationMin) × 0.006` logged per item + `totalCostUsd` per batch; seen in live logs. |

---

## 6. Accessibility quick pass (NFR-8 scope)

| Item | Result |
|---|---|
| Programmatic label | `<label for="urls">Post URLs</label>` present in rendered HTML. |
| Error association | `aria-describedby` on textarea (→ `urls-helper` / `input-errors`), `aria-invalid` toggles. |
| Live region | One visually-hidden `aria-live="polite"` region; announces per-card transitions + "N of M succeeded" + "Transcript copied". Cards are not individual live regions (correct — avoids 50-region noise). |
| Keyboard path | All actions are real `<button>`/`<a>` (no click-divs); Ctrl/Cmd+Enter submits, bare Enter does not (`ui.actions.test.tsx`). Tab order = DOM order = spec §7. |
| Visible focus | `:focus-visible` rules present in `globals.css` (l.65); no `outline:none` without replacement. *(Note: focus styling is in the external CSS, not inline — my HTML grep for "focus-visible" returned false because it lives in globals.css, confirmed by file read.)* |
| Colour-only meaning | Status carried by text + glyph (✓/✕/○/•/◌), not colour alone. |
| Headings | Page `<h1>`; each card heading is the source URL as `<h2>` for SR navigation. |

No accessibility blockers within the NFR-8 v1 bar.

---

## 7. Defect log

No Blocker, no Major. All findings are spec-drift or cosmetic.

| ID | Severity | Title | Repro / detail | Artifact violated |
|---|---|---|---|---|
| **D-1** | Minor | Card status badge text drifts from spec card-anatomy wording | Spec §5 status table lists "Failed (with reason below)" as the generic status word; the build instead shows the **specific** copy ("Couldn't fetch this post" / "Transcription failed") directly as the status line. This is actually *better* UX and matches the §5 failed-variant table and §6 microcopy — but it contradicts the §5 generic "Status" row that says one word "Failed". Spec-internal inconsistency, not a build bug. | experience-spec §5 (self-contradictory) — flag to ux-designer |
| **D-2** | Minor | `geo_blocked` / `login_required` / `rate_limited` all render under the single "Couldn't fetch this post" status with only the detail line differentiating | Per spec §5 these are all "unfetchable" variants → acceptable, but a geo-block and a rate-limit get the same headline and a "Retry, or open the link to check it still exists" suffix that is slightly misleading for a rate-limit (the link is fine; retry later is the action). Microcopy could mislead the user on next action. | experience-spec §6 (copy fitness) — minor |
| **D-3** | Minor | No DNS-rebinding defence in URL validation | `validation.ts` blocks IP-literal hosts but a hostname that *resolves* to a private/loopback IP at fetch time is not re-checked. Untestable offline; only live. Should be added to LB-01 hardening (pin/verify resolved IP, or run fetch egress-restricted). | PRD threat model / NFR-4 — pre-existing, deferred |
| **D-4** | Trivial | Tagline copy not in the microcopy table | The page tagline ("Paste public post URLs and read what was said… export the CSV if you need them") is product copy not present in experience-spec §6. Reasonable and on-tone, but unreviewed by design. | experience-spec §6 (untracked copy) |
| **D-5** | Trivial | `displayLanguage` capitalises unknown raw languages generically | A provider returning e.g. "haitian creole" renders "Haitian Creole" (good), but an unexpected code not in the map renders title-cased raw text. Only surfaces with live STT; fixture path fine. | none (defensive note) |

---

## 8. NOT VERIFIED list (deferred — tied to LB-01 / LB-02)

These are **correctly out of QA's offline reach** per delivery-plan §1 sandbox contingency and §8 live-network row. They are **not defects** — they are the release-gate's job:

| Item | Why deferred | Owner / gate |
|---|---|---|
| Live yt-dlp fetch across all 3 platforms (ADR-001 thresholds: YT ≥5/5, TikTok ≥4/5, IG ≥3/5) | Sandbox cannot reach platforms | **LB-01** — user, release gate |
| Real whisper-1 `/audio/translations` call + `verbose_json.language` field (RK-6) | No `OPENAI_API_KEY`; no network | **LB-01** |
| Real yt-dlp stderr → taxonomy calibration (RK-7) | Taxonomy built from documented strings, not live | **LB-01** |
| NFR-1 / NFR-2 real wall-clock timings | Need live fetch + STT | **LB-01** |
| NFR-3 accuracy (≥8/10 usable across priority languages) | Human rating task on real posts | **User pre-launch task**, materials in README |
| NFR-4 network reachability (internal-only) | Deploy-environment check | **Release/deploy** |
| Docker `docker build` + container boot | No Docker daemon in sandbox (confirmed: `docker info` fails) | **LB-02** — release gate |

I confirmed the **T-404 launch checklist exists and is non-engineer-executable**: README §"Launch checklist" lists LB-01 (with runbook + ADR-001 thresholds), LB-02 (first docker build), NFR-3 accuracy materials, NFR-4 reachability, and RK-7 recalibration. Dockerfile exists with the pin-after-LB-01 path documented.

---

## 9. Release recommendation

### Verdict: **GO-WITH-KNOWN-ISSUES**

**Rationale.** Every offline-verifiable acceptance criterion across ST-01..04 passes under my own re-run and live probing; the SSRF/injection defence — the explicitly named break target — held against every probe; all 9 NFRs are either verified or correctly partial-with-a-named-deferral. There is no Blocker and no Major defect, so the pipeline's automatic-NO-GO condition does not fire. The deferred items are not gaps in the build — they are the documented, planned consequences of a sandbox that cannot reach live platforms, and they are gated behind a launch checklist the release-manager must enforce.

**This is a GO only if the user explicitly accepts the following (they are launch-blocking, not ship-and-hope):**
1. **LB-01 must be executed and pass before public/internal launch** — live fetch thresholds (ADR-001), one real transcript per platform, `verbose_json.language` confirmation, and real-stderr taxonomy recalibration. If LB-01 fails YouTube or two platforms, ADR-001's kill/pivot ladder fires — **the release is not authorised on QA's say-so alone.**
2. **LB-02 must pass** — the Docker image has never been built or booted; DoD #7 is unmet by environment. A green `docker build` + `/api/health` 200 in the container is a hard gate.
3. **NFR-3 accuracy check** (≥8/10 usable) is the user's pre-launch task — the product's only value (readable transcripts) is **unverified** until they rate real posts.
4. **NFR-4 reachability** — confirm the deployed URL is internal-only; there is no auth.
5. Accept the single-instance fragility (RK-4): a restart loses in-flight batches by design.

If the user accepts items 1–5 as named release blockers owned by the release-manager/user, **ship**. If any of 1–4 cannot be committed to before launch, this reverts to **NO-GO** until they can.

---

## 10. Coverage honesty note — what was NOT tested and why
- **No live network anything** — all fetch/STT behaviour is fixture-driven; real platform/provider behaviour (the product's core risk, R1/R2) is entirely LB-01's job. My PASS marks on transcript *content* mean "the pipeline carries fixture text correctly," not "real transcription is accurate."
- **No Docker** — no daemon present; image is unbuilt/unbooted (LB-02).
- **No real concurrency-at-scale or sustained load** — backpressure logic verified, but 5 real users × real fetch latency is untested.
- **No cross-browser run** — code-inspected HTML/CSS only; no actual Chrome/Edge session, no real screen-reader pass (NFR-8 defers full WCAG anyway).
- **No DNS-rebinding / live-egress SSRF** — the validation layer is proven; the runtime fetch egress is not (D-3).
