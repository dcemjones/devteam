# ADR-001 — Media fetching from Instagram, TikTok, YouTube

**Status:** Proposed (Architecture gate) — **this is the product's kill-risk (PRD R1)**
**Date:** 2026-06-10

## Context

The product's first step is downloading audio from public post URLs on three platforms that do not offer an official "download this post's media" API for third parties:

- **YouTube:** official Data API returns metadata only, not media streams.
- **Instagram:** Graph API media access requires the *influencer's* account authorisation — not available for arbitrary public posts by third-party creators.
- **TikTok:** Display API similarly requires creator authorisation; no public media-download API.

So any v1 within a 1-week appetite fetches media the way the browser does — by scraping the public page/CDN. The de-facto standard tool is **yt-dlp** (actively maintained as of 2026, daily releases, supports YouTube, TikTok and Instagram posts/Reels among 1000+ sites).

**Reliability reality (2026):**
- *YouTube:* most stable extractor; breakage rare and fixed fast.
- *TikTok:* public videos generally work without cookies, but extractor breakages are recurring (e.g. "Unable to extract webpage data" issues reported into 2026) and per-IP blocks happen ("Your IP address is blocked from accessing this post"), especially from datacenter IPs.
- *Instagram:* the most hostile. Public posts/Reels often work, but Instagram increasingly login-walls anonymous access; the user/story extractors have documented breakage, and reliability without session cookies is the weakest of the three. ASSUMPTION until the spike: anonymous public-Reel fetch succeeds for a usable majority from our deployment IP.

**ToS position — stated honestly:** automated downloading of platform media very likely breaches all three platforms' Terms of Service (YouTube's ToS prohibit downloading content without explicit permission; Instagram's and TikTok's terms prohibit automated access/scraping). Practical exposure for an internal, low-volume (tens of fetches/day), public-content-only compliance tool is most plausibly **IP blocking or fetch failure, not legal action** — but that is a business-risk judgement the requester must own, not an engineering fact. **This ADR requires explicit requester acceptance at the Architecture gate** (logged in `/product/questions.md` → OPEN list in architecture.md). Note the purpose (verifying contracted influencers' compliance) and immediate media deletion (NFR-7) are mitigating context, not a ToS cure.

**Expected breakage modes & maintenance cost:**
1. Extractor breaks after platform markup/API change → all fetches for that platform fail until yt-dlp ships a fix (typically days) and we rebuild the container. Expect this **multiple times a year for TikTok/Instagram**.
2. IP-level blocking/rate-limiting of our server, especially datacenter IPs → intermittent `login_required`/`rate_limited` failures. Mitigated by low concurrency (4 workers) and low volume; residential proxies are explicitly **out of scope** for v1 (cost, sketchiness, appetite).
3. Login-walling (Instagram) → anonymous fetch fails entirely; only cure is session cookies (fallback rung 2).
Budget assumption: ~0.5 day/month of maintenance (container rebuild + occasional error-mapping tweak). ASSUMPTION — revisit at retro.

## Decision

**Use yt-dlp (pinned static binary in the container, documented update path) as the single fetch mechanism for all three platforms**, invoked as a child process with argument arrays (no shell), audio-only mode (`-x`), with hostname-allowlisted URLs (SSRF guard, architecture §10) and yt-dlp stderr mapped to a small user-facing failure taxonomy.

**Mandatory day-1 spike (PRD A1/A2) — gates all further build. It must prove:**
1. Latest yt-dlp, run from the *actual deployment environment's* network (datacenter IP matters), fetches audio for **5 recent real public post URLs per platform** supplied by the requester (15 URLs total).
2. **Pass thresholds:** YouTube **≥5/5**, TikTok **≥4/5**, Instagram **≥3/5**, all without cookies. (Thresholds chosen so the PRD success metric — usable transcript for ≥80% of valid URLs overall — remains reachable given YouTube-heavy mixes; Instagram gets the lowest bar because it has fallback rungs.)
3. End-to-end: 3 of the fetched posts (one per platform, non-English) through `whisper-1` `/translations`; requester rates each transcript usable/not (A2 early signal); record per-post cost and wall-clock time (A5, NFR-1 evidence).
4. Verify two technical ASSUMPTIONS: 64 kbps mono m4a of a 15-min post stays <25 MB; `/translations` `verbose_json` returns the detected source language.

**Spike outcomes:** all thresholds pass → proceed as designed. Instagram fails only → drop to fallback rung 2 or 3 and proceed. YouTube or two platforms fail → escalate to the user at the gate with a **kill/pivot recommendation** — do not build around it silently.

**Fallback ladder (in order, each rung is a deliberate de-scope routed through the orchestrator, not a silent patch):**
1. **All three via anonymous yt-dlp** (the design above).
2. **Instagram with session cookies:** a throwaway IG account's exported cookie file mounted as a secret. Cost: account-ban churn, manual cookie refresh (~monthly), deeper ToS breach. Only with requester sign-off.
3. **Manual file-upload escape hatch:** for platforms that won't fetch, the user downloads the post themselves (browser tools) and uploads the file; the pipeline runs from EXTRACT. Cheap to build (~half-day: one upload endpoint feeding the existing pipeline) but **a PRD scope change — route back to PM** for a v2 PRD line before building.
4. **YouTube-only v1:** ship the platform that works, mark IG/TikTok "coming when fetchable". Matches the PRD's cut-first order (third platform is cut #3; single-URL YouTube path is never cut).

## Consequences

- One innovation token spent; everything downstream of FETCH is provider-grade boring.
- We own a permanent, low-grade maintenance burden (container rebuilds on extractor breakage) and an explicit ToS exposure the requester must accept.
- Failure UX must be first-class (it is — ST-04, per-item isolation), because partial fetch failure is *normal operation*, not an edge case.
- Deployment IP reputation becomes architecturally relevant — a thing teams rarely expect; documented in operability notes.
- What this makes harder: any future "scheduled monitoring" feature (parked in PRD) multiplies fetch volume and IP-block risk — this ADR's position does **not** automatically extend to it.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Official platform APIs** | None of the three provides third-party media download for arbitrary public posts; Instagram/TikTok creator-auth flows are unusable for monitoring *other people's* accounts. Dead end, not just hard. |
| **Commercial scraping APIs (Apify, ScrapingBee, Bright Data et al.)** | Outsources breakage but not ToS exposure; adds per-fetch cost ($1–5+/1k typical, ASSUMPTION — unverified) and a vendor; still scraping underneath. Worth revisiting if yt-dlp maintenance exceeds ~1 day/month. |
| **Manual upload only (no fetching)** | Eliminates R1 entirely but guts the JTBD — "paste URLs, read transcripts" becomes "download 50 videos by hand". Kept as ladder rung 3, not the product. |
| **Headless-browser scraping (Playwright)** | Strictly worse than yt-dlp: same ToS position, heavier, and we'd maintain extractors ourselves that yt-dlp's community maintains for free. |
