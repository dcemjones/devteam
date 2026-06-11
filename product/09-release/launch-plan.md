# Launch Plan — Influencer Transcript Translator (v1)

**Status:** Draft — awaiting Release gate
**Date:** 2026-06-11
**Owner of this launch:** the requester (you) — this plan is written so you can run it without an engineer at your elbow.
**Inputs:** `/product/08-quality/test-report.md` (verdict GO-with-known-issues, all five items accepted by you on 2026-06-11), `/src/README.md` (launch checklist + LB-01 runbook), `/product/03-definition/prd.md`, `/product/05-architecture/architecture.md` + ADR-001/ADR-003, `/product/changelog.md`, `/product/questions.md`.

## Executive summary (5 lines)
1. We launch in three small steps: **Phase 0** proves the things the build sandbox couldn't (live fetching, real transcription, the Docker container, network privacy); **Phase 1** is just you using it for real; **Phase 2** opens it to the team (≤5 people).
2. Nothing ships until the **LB-01 fetch spike passes its ADR-001 thresholds** (YouTube 5/5, TikTok 4/5, Instagram 3/5) — if it doesn't, the ADR-001 fallback ladder decides what happens next; we never ship around a failed spike silently.
3. Rollback is trivial by design: the app stores nothing durable, so "roll back" means **stop the container** — no data to unwind, no migrations to reverse.
4. Success is the PRD metric: **usable English transcript for ≥80% of the first 50 real submissions**, tallied by you with a simple sheet; cost is watched against the **$25–40/month** projection using the app's own cost logs.
5. **Launch-blocking today:** Q-005 — you owe the 15 spike URLs (5 YouTube, 5 TikTok, 5 Instagram, ≥3 non-English). Nothing in Phase 0 can start without them.

---

## 1. Rollout strategy — phased, smallest blast radius first

Why phased: this product's two real risks (platforms blocking fetches; transcript quality in your languages) can only be tested live. So we test them live **on an audience of one** before anyone else touches it. Big-bang would just mean five people discovering the same problem at once.

### Phase 0 — Pre-launch gates (you + the deployed container; no users yet)
**Entry criteria:** Q-005 answered (15 spike URLs in `/product/questions.md`); an `OPENAI_API_KEY`; a place to run one Docker container.
**Duration:** half a day to one day.
**Run these four gates in this order** (order matters — each one is cheaper to fail than the next):

| # | Gate | What it proves | Pass condition | Owner |
|---|------|----------------|----------------|-------|
| 0.1 | **LB-02 — Docker build + boot** | The container has never been built; verify it builds, boots, and is healthy before spending spike effort on it. | `docker build` succeeds; `/api/health` returns green in real mode; one URL end-to-end; `docker logs` shows `media_purged` and `costUsd` lines. Full steps: `/src/README.md` § "Launch checklist" → LB-02, and the runbook in §2 below. | You |
| 0.2 | **NFR-4 — privacy/reachability check** | The app has no login, so the network is the lock. Do this *before* you start feeding it real campaign URLs. | The deployed URL is unreachable from outside your internal network (test from a phone on mobile data), or is an unguessable hostname; the cloud metadata endpoint is blocked from the container (ask whoever runs your hosting to confirm — one sentence from them is enough). | You (+ hosting admin) |
| 0.3 | **LB-01 — live fetch + transcription spike** | The product's kill-risk: can we actually fetch from the three platforms, and does real transcription work? Follow the step-by-step runbook in `/src/README.md` § "Launch checklist" → LB-01 — it is written for a non-engineer. Don't duplicate it; just run it. | **ADR-001 thresholds: YouTube ≥5/5, TikTok ≥4/5, Instagram ≥3/5**, all without cookies. Also record: detected language shows on non-English posts, per-post wall-clock vs NFR-1 (≤3-min post in ≤3 min), and `costUsd` lines vs the cost model. | You |
| 0.4 | **NFR-3 — accuracy rating** | The product's only value is readable transcripts; this is the first time anyone checks it. | You rate transcripts of **10 real posts** across your priority languages (Q-001): each one usable / not usable for judging guideline adherence. **≥8/10 usable = pass.** | You |

**If LB-01 misses a threshold — the ADR-001 fallback ladder (these are the only allowed outcomes; each goes back through the orchestrator, none is a quiet workaround):**
- **Instagram fails only** → rung 2 (Instagram session cookies — needs your sign-off, deeper ToS exposure) or rung 3 (manual file upload — a small PRD change, ~half a day of build) or rung 4 (launch without Instagram). Launch can proceed for the passing platforms.
- **YouTube fails, or two platforms fail** → **stop. Kill/pivot decision at the gate.** The release is not authorised — QA said this explicitly and you accepted it.
- **NFR-3 fails (<8/10 usable)** → ADR-002 upgrade path (better transcription model + translation step, ~half a day). Do not launch on transcripts you yourself rated unusable.

**Exit criteria for Phase 0:** all four gates passed (or fallback rung agreed and applied), results recorded in `/product/changelog.md`.

### Phase 1 — Soft launch, single user (you)
**Entry criteria:** Phase 0 complete; baseline tally sheet created (§4 below).
**Who:** you only. **Duration:** 2–4 working days, or until ~15–20 real submissions are through.
**What to do:** use it for real work — actual campaign batches, not test URLs. Tally every submission (§4). Note anything confusing, slow, or wrong.
**Exit criteria:** ≥15 real submissions; running usable-rate is on track for ≥80%; no surprise failures outside the known-issues list; cost per transcript matches the model (~$0.006/audio-minute).
**If exit criteria aren't met:** stay in Phase 1 and route the problem back through the orchestrator (build-stage fix or copy fix). Do not widen the audience to "see if it happens for others too".

### Phase 2 — Team launch (≤5 users)
**Entry criteria:** Phase 1 exit criteria met; comms sent (§6); the three must-knows acknowledged by each user.
**Who:** the full team, up to 5 people. **Duration:** ongoing; hypercare for the first 2 weeks (§5).
**Exit criteria (= launch considered done):** 50 real submissions reached or 2 weeks elapsed — whichever comes first — then the retro fires (§7).

---

## 2. Launch-day runbook (Phase 0, steps 0.1–0.2 expanded)

The LB-01 spike runbook already exists in `/src/README.md` and is the authoritative version — this section only covers getting the container up and smoke-tested so you can run it. Work top to bottom; every step says what you should see and what to do if you don't.

| Step | Do this | Expected result | If it fails |
|---|---|---|---|
| 1 | Get an `OPENAI_API_KEY` from your OpenAI account (platform.openai.com → API keys). **Handle it like a password:** put it in your hosting platform's secret store, never in a file in the repo, never in chat/email. The app never logs it (it redacts key-like values). | You have a key starting `sk-`. | No OpenAI account → create one and add a small payment method; expected spend is cents during the spike, $25–40/month after. |
| 2 | From `/home/user/devteam/src`: `docker build -t itt .` | Build completes without error. (This is the first-ever build — LB-02.) | Copy the last ~20 lines of output and route back through the orchestrator to the build stage. **Stop here.** |
| 3 | `docker run -p 3100:3100 -e OPENAI_API_KEY=sk-... itt` (on your hosting platform, set the key from the secret store instead of typing it; configure **exactly one instance, always on — min=max=1**, per ADR-003. A second instance or scale-to-zero silently breaks the app.) | Container starts; logs show a startup line stating the single-instance constraint. | If it exits complaining about a missing key, the env var didn't reach it — re-check step 1's secret wiring. |
| 4 | Open `http://<host>:3100/api/health` in a browser. | JSON with `ok: true` — temp dir writable, key present, yt-dlp version reported. | Any check red: temp-dir → hosting disk/permissions; key → step 3; yt-dlp → the image is broken, route back to build stage. |
| 5 | **NFR-4 check (gate 0.2):** open the app URL from a device *outside* your network (phone on mobile data). | It does **not** load from outside (internal network), or the hostname is unguessable and you've shared it with no one yet. | Reachable on a guessable public URL → **stop**; fix the network placement with your hosting admin before any real URL goes in. |
| 6 | **First smoke batch:** paste one public YouTube URL (any short one) into the app and submit. | Card goes queued → processing → done with an English transcript; `docker logs` shows step timings, a `costUsd` line, and `media_purged`. | Card fails → read the card's reason; check `docker logs` for the underlying error; if it's gibberish to you, copy the log lines and route back through the orchestrator. |
| 7 | Proceed to the **LB-01 spike** exactly as written in `/src/README.md` § "Launch checklist" (paste each platform's 5 URLs as one batch; record per-platform counts; rate the 3 non-English transcripts; record wall-clock and cost). Then do the **NFR-3 rating** (10 posts). | Thresholds in §1 table met. | Apply the fallback ladder in §1. Do not improvise. |

---

## 3. Rollback plan

**The good news first: rollback is trivial, by design.** The app has no database, no migrations, and keeps nothing durable (NFR-7). Stopping the container *is* the rollback — there is no state to repair afterwards. The only thing lost is in-flight batches (the accepted RK-4 behaviour); users resubmit. Transcripts already copied out or exported to CSV are on users' machines and unaffected. Because the rollback is "stop one container", it needs no rehearsal beyond confirming you know the stop command on your hosting platform — confirm that during Phase 0, step 3.

**Who can pull the cord:** you, unilaterally, at any time. No approval needed.

| Trigger | Action |
|---|---|
| LB-01 thresholds missed at launch (YouTube fail, or two platforms fail) | Don't launch. This isn't rollback — it's the gate working. Kill/pivot decision per ADR-001. |
| After launch: most submissions failing (rough rule: >half of a real batch fails on more than one batch, and retry doesn't help) | Stop the container (`docker stop <container>` or your platform's stop button). Tell users via the team channel: "Tool paused, resubmit later." Route logs back through the orchestrator. |
| Cost runaway: daily `costUsd` totals imply far beyond ~$40/month (e.g. >$5 in a single day at expected volume) | Stop the container; check logs for who/what submitted (NFR-9 cost lines per item); if usage is legitimate, the cost model needs revisiting before restart (Q-002 volume answer). |
| Discovered reachable from the public internet | Stop the container immediately (no auth exists — this is the one genuine emergency). Fix network placement, then restart. |
| Instagram and/or TikTok fetching degrades *after* launch (cards mostly "Couldn't fetch this post", logs full of `extractor_error` / `rate_limited`) | **Don't stop the tool — degrade it.** First try the maintenance fix (rebuild the image to pull a newer yt-dlp, §5). If that doesn't cure it, fall back down the ADR-001 ladder: tell users "YouTube-only until further notice" (rung 4), and decide with the orchestrator whether to invest in rung 2 (IG cookies) or rung 3 (manual upload). |
| Restart needed for any reason | Just restart. Stateless: in-flight batches are lost (RK-4, accepted), users see "This batch is no longer available — please resubmit". Nothing else to do. |

---

## 4. Baseline and success measurement — set up BEFORE Phase 1

**The metric (PRD):** usable English transcript for **≥80% of valid public post URLs over the first 50 real submissions**, without engineering help.

**Baseline:** captured in Phase 0 — the LB-01 per-platform success counts, the NFR-3 usable rating (n/10), per-post wall-clock times, and per-post `costUsd`. Write these four numbers into `/product/changelog.md` when you pass the gates. That's the "before" picture the retro compares against.

**The tally (your job, ~30 seconds per batch):** keep one spreadsheet with a row per submitted URL:

> date · platform · result (transcript / no-speech / failed) · usable? (yes/no — your judgement, same bar as NFR-3) · needed engineering help? (yes/no)

- The app's CSV export gives you most of this — export each batch and paste the rows in; you only add the two judgement columns.
- "No speech detected" counts as **completed**, not failed (PRD ST-04). A failed fetch on an invalid/private URL doesn't count against the metric — the metric is over *valid public* URLs.
- At 50 rows: usable ÷ valid ≥ 80% = success. This number is the headline of the retro.

**Cost watch:** the app logs `costUsd` per transcript and per batch (NFR-9). Once a week, skim the logs (or sum your tally sheet's batches × the logged costs) and compare against the **$25–40/month** projection (architecture §11: ~$13.50/month in API fees + $10–25 hosting). Also glance at your OpenAI billing dashboard — that's the ground truth.

---

## 5. Hypercare — first 2 weeks after Phase 2

**Who watches:** you. **Cadence:** a 5-minute daily check; weekly cost check.

**Daily (5 min):**
- Skim `docker logs` for `extractor_error` — see below.
- Glance at your tally sheet's running usable-rate.
- Ask the team channel: anything weird?

**The one expected breakage — yt-dlp / platform changes (this is normal maintenance, not an incident):**
- **What it looks like:** a platform that worked yesterday suddenly fails on every URL; cards say "Couldn't fetch this post"; logs show `extractor_error` spiking. Expect this roughly **monthly**, most likely TikTok or Instagram (ADR-001 budgets ~0.5 day/month for it).
- **What to do:** rebuild the container image — that pulls a newer yt-dlp with the fix (`docker build -t itt . && docker run ...` per §2, or your platform's "rebuild + redeploy" button). If yt-dlp hasn't shipped a fix yet, it usually lands within days — tell users that platform is down, and carry on with the others (per-URL failure isolation means the rest of the tool keeps working).
- **Also during LB-01 and hypercare (RK-7):** if logs show failures coded `unknown`, the error-mapping needs extending — collect the log lines and route back through the orchestrator.

**Who to call for anything beyond a rebuild:** there is no on-call. Fixes go through the orchestrator by **re-running the pipeline's build stage** with the problem description and the relevant log lines. Plain-language bug reports are fine — the logs carry the technical detail (NFR-6 guarantees a failed URL is diagnosable from logs alone).

**Weekly:** cost check (§4); confirm the running container is still exactly one instance.

**Hypercare exit criteria:** 2 weeks elapsed with no unresolved Blocker-level problem, usable-rate on track, cost within projection. Then the tool is in normal operation (daily checks stop; the monthly yt-dlp rebuild expectation remains).

---

## 6. Comms and training

### Announcement to the team (send at Phase 2 — copy/paste and edit the URL)

> **New tool: Influencer Transcript Translator** — paste public Instagram, TikTok or YouTube post URLs (up to 50 at a time, one per line) at `<internal URL>`, and get back an English transcript of what was said in each post, with the source language auto-detected. Copy any transcript, or export the whole batch as a CSV. No login needed. Questions or problems → `<you>` in `<team channel>`.
>
> **Three things you must know before using it:**
> 1. **If the tool restarts, in-progress batches are lost** — you'll see "This batch is no longer available — please resubmit". Just resubmit; nothing is broken. Copy out or export results you care about when you see them — nothing is stored.
> 2. **Failures are per-URL, not per-batch.** If 2 of your 10 URLs fail, the other 8 are fine. Read the reason on the failed card — it tells you whether to hit Retry, check the post still exists, or give up on that one.
> 3. **Export CSV gives you everything** — successes *and* failures with their reasons — in one file. Use it for your review notes instead of copying cards one by one.

### Support brief (for you, the de-facto support person)

Known issues accepted at the Quality gate, **verbatim from the QA report** — these are not surprises, they are the deal we shipped under:

1. **LB-01 must be executed and pass before public/internal launch** — live fetch thresholds (ADR-001), one real transcript per platform, `verbose_json.language` confirmation, and real-stderr taxonomy recalibration. If LB-01 fails YouTube or two platforms, ADR-001's kill/pivot ladder fires — **the release is not authorised on QA's say-so alone.**
2. **LB-02 must pass** — the Docker image has never been built or booted; DoD #7 is unmet by environment. A green `docker build` + `/api/health` 200 in the container is a hard gate.
3. **NFR-3 accuracy check** (≥8/10 usable) is the user's pre-launch task — the product's only value (readable transcripts) is **unverified** until they rate real posts.
4. **NFR-4 reachability** — confirm the deployed URL is internal-only; there is no auth.
5. Accept the single-instance fragility (RK-4): a restart loses in-flight batches by design.

(Items 1–4 are discharged by Phase 0; item 5 is permanent and is must-know #1 in the announcement above.)

**FAQ for likely questions:** "It says rate-limited / couldn't fetch but the post is fine" → wait and Retry; if a whole platform is failing, see the yt-dlp rebuild note (§5). "Post too long" → 15-minute cap is by design (v1). "My batch disappeared" → restart happened (RK-4) — resubmit. "Can I use it on my phone?" → no, desktop Chrome/Edge only. **Escalation:** anything else → collect the failing URL + time, you pull the log lines, route through the orchestrator to the build stage.

---

## 7. Retro date

**Retro fires at: 2 weeks after Phase 2 starts, or when the tally sheet reaches 50 real submissions — whichever comes first.**
If Phase 0 runs the week of 2026-06-15 and Phase 2 starts ~2026-06-18 (ASSUMPTION: phases run to plan), the retro lands **on or before 2026-07-02**. The retro-analyst (stage 10) compares: usable-rate vs ≥80%, real wall-clocks vs NFR-1/2, actual monthly cost vs $25–40, actual yt-dlp maintenance vs the 0.5-day/month budget, and whether any fallback-ladder rung had to fire.

---

## 8. OPEN items and assumptions

| Item | Status | Impact |
|---|---|---|
| **Q-005 — 15 spike URLs** (5 per platform, ≥3 non-English, from your real influencers) | **OPEN — launch-blocking.** Phase 0 cannot start without them. Answer in `/product/questions.md`. | Blocks gate 0.3 (LB-01). |
| **Q-001 — priority languages** | OPEN — needed to pick the 10 posts for the NFR-3 rating set (gate 0.4). | ASSUMPTION if unanswered: rate against the PRD working set (Spanish, Portuguese, French, German, Japanese, Korean, Indonesian) — but the rating is only as meaningful as the languages are real for you. |
| **Q-002 — expected volume** | OPEN — not launch-blocking. | ASSUMPTION: low tens of batches/month; the $25–40/month projection and the cost-runaway trigger (§3) both rest on it. |
| **Q-004 — 15-minute post cap** | OPEN — not launch-blocking. | ASSUMPTION: cap stands; longer posts are rejected with a clear message. |
| Hosting platform choice | ASSUMPTION: you have somewhere to run one always-on Docker container (min=max=1) on the internal network, with a secret store for the API key. If not, that's a half-day conversation with whoever owns your infrastructure — have it before Phase 0. |
| Go/No-Go ownership | Every gate in §1 has a named owner (you, plus your hosting admin for half of 0.2). Per release rules: if an item loses its owner, the answer is No-Go. |
