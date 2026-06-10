# Open Questions

> Agents log questions they can't resolve here (anything labelled OPEN in an artifact that needs your answer). Answer inline under each question, then tell the orchestrator to resume. Resolved questions move to the bottom.

## Open

### Q-001 · [03-definition/product-manager] · 2026-06-10
**Question:** Which source markets/languages matter most for influencer posts?
**Why it matters:** Drives speech-to-text/translation provider choice (risk R2) and which languages the pre-launch accuracy check uses (NFR-3). Provider quality varies sharply by language.
**Agent's working assumption if unanswered:** Major EU + LATAM + APAC languages with strong commercial STT support (Spanish, Portuguese, French, German, Japanese, Korean, Indonesian).
**Your answer:** _(write here)_

### Q-002 · [03-definition/product-manager] · 2026-06-10
**Question:** Expected volume — how many URLs per batch, and how many batches per week?
**Why it matters:** Sets the batch limit (NFR-2) and the cost projection for STT/translation fees (risk R3).
**Agent's working assumption if unanswered:** ≤50 URLs per batch, low tens of batches per month.
**Your answer:** _(write here)_


### Q-004 · [03-definition/product-manager] · 2026-06-10
**Question:** Is a 15-minute maximum post length acceptable for v1? (YouTube posts can be long-form.)
**Why it matters:** Caps processing time and per-transcript cost (NFR-1); longer posts would be rejected with a clear message.
**Agent's working assumption if unanswered:** 15-minute cap stands for v1.
**Your answer:** _(write here)_

### Q-005 · [06-plan/delivery-planner] · 2026-06-10
**Question:** Please provide 15 real public post URLs for the fetch spike — 5 each from Instagram, TikTok, and YouTube, by influencers in your actual markets.
**Why it matters:** The day-1 fetch spike (and launch-blocking check LB-01 if the build sandbox can't reach the platforms) needs real URLs to prove fetching works at the ADR-001 thresholds before launch. Using your real influencers' posts also makes the accuracy check meaningful.
**Agent's working assumption if unanswered:** Build proceeds on fixture media; LB-01 (spike executed by you at release) becomes launch-blocking.
**Your answer:** _(write here)_

<!-- Question format (use sequential ids Q-001, Q-002, …):
### Q-XXX · [stage/agent] · YYYY-MM-DD
**Question:** ...
**Why it matters:** ...
**Agent's working assumption if unanswered:** ...
**Your answer:** _(write here)_
-->

## Resolved

### Q-003 · [03-definition/product-manager] · 2026-06-10
**Question:** Is no-login acceptable for v1, given how/where this will be deployed?
**Why it matters:** v1 has no auth (NFR-4); it must not end up as a public unauthenticated service processing your campaign URLs.
**Agent's working assumption if unanswered:** Yes — deployed reachable only by the internal team (internal network or unguessable URL).
**Answer (2026-06-10, gate Q&A):** Yes — no-auth is fine; deploy behind an unguessable URL / internal network.

