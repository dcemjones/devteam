# Request Brief — Influencer Transcript Translator

**Status:** Draft
**Date:** 2026-06-10
**Mode:** Fast-track (appetite ≤ 1 week — stages 1–3 collapse into one product-manager pass)

## Executive summary
Brand/marketing user needs to verify that influencers in non-English markets are adhering to brand guidelines in their Instagram, TikTok, and YouTube posts. The app takes post URLs (single or bulk), extracts and interprets the audio, translates it to English, and outputs the English transcript. Compliance checking itself stays human — the app's job ends at a trustworthy English transcript. Appetite is small (≤1 week), so the first version is the smallest coherent slice: URL in → English transcript out.

## Request (verbatim)
> "build a social influence app, that will take instagram, tiktok, and youtube posts done by influencers from different markets, interpret the audio, translate to english, and output the english variant. this is so the user can check the influencer is adhering to the brand guidelines."

## Goal
Let the user read, in English, what an influencer actually said in a post from any market, so they can check it against brand guidelines without speaking the source language.

## Target user
Brand / marketing / compliance person managing influencer campaigns across multiple markets. ASSUMPTION: internal tool for a small team, not a public consumer product.

## Appetite
**≤ 1 week** (user-selected: "Small"). Scope bends to this, not the reverse.

## Decisions captured at intake
| Question | Answer |
|---|---|
| Ingestion | Paste a URL or bulk-upload a list of URLs (Instagram, TikTok, YouTube) |
| Compliance checking | Out of scope — transcript only; human does the guideline check |
| Appetite | Small, ≤1 week → fast-track |

## Constraints
- Platforms: Instagram, TikTok, YouTube post URLs.
- Output: English transcript per post ("the english variant").
- ASSUMPTION: source languages are whatever the influencer speaks — auto-detect rather than a fixed language list.
- ASSUMPTION: fetching public post media via URL is acceptable to the user; platform ToS / fetch reliability is a known risk to be addressed in architecture.

## Definition of "good enough"
User pastes one or many post URLs and gets back, per post, a readable English transcript of the spoken audio, clearly tied to the source URL, accurate enough to judge guideline adherence.

## Explicitly out of scope (v1)
- Automated brand-guideline checking, flagging, or scoring.
- Auto-monitoring influencer accounts / scheduled ingestion.
- On-screen text (OCR), captions analysis, image/visual compliance.
- User accounts, team management, audit trails.

## OPEN items (logged in /product/questions.md if they block a stage)
- OPEN: which source markets/languages matter most (affects translation QA priorities)?
- OPEN: expected volume per batch (10s vs 1000s of URLs affects architecture)?
