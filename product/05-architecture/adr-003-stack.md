# ADR-003 — Runtime and stack for `/src`

**Status:** Proposed (Architecture gate)
**Date:** 2026-06-10

## Context

The implementation-engineer builds the product in `/src` of this repo. The repo root is an existing **Next.js dashboard app** (workspace infrastructure); the product must not be entangled with it — own dependencies, own build, own deployment. The product needs: a small single-page UI, a JSON API, long-running background work per item (10 s–10 min), child-process orchestration of `yt-dlp`/`ffmpeg` binaries, and **in-memory job state shared across requests** — which together rule out anything serverless or multi-instance.

Boring-technology bias: the team demonstrably runs Next.js/TypeScript. The one innovation token is already spent on yt-dlp (ADR-001), so the runtime must cost zero novelty.

## Decision

**A standalone Next.js (App Router) + TypeScript application in `/src`, with its own `package.json` and lockfile, zero imports to or from the root app, deployed as a single always-on Node process (`next start`) in a Docker container that also contains pinned `yt-dlp` and `ffmpeg` binaries.**

- UI: one page, React, client-side polling every 2 s. No component library needed beyond what the team already uses.
- API: Next.js route handlers under `app/api/*` (architecture §7).
- Pipeline: plain TypeScript modules (`fetcher.ts`, `extractor.ts`, `transcriber.ts`, `registry.ts`, `pool.ts`) invoked from route handlers; concurrency via `p-limit` or a 30-line hand-rolled pool. Child processes via `child_process.spawn` with argument arrays.
- State: module-scope `Map` for the batch registry. **This binds us to exactly one instance and forbids serverless/scale-to-zero/dev-mode-style process recycling** — deployment must be `next start` (or standalone output) in one long-lived container, min=max=1 instance. This constraint is the headline consequence and is documented in architecture §13.
- Isolation from root app enforced by: separate lockfile, separate Dockerfile/deploy, no path aliases crossing the boundary, CI builds `/src` independently.

## Consequences

- Engineer starts productive in hour one: same framework as the rest of the workspace, one repo, one deployable serving UI + API.
- The single-instance constraint is load-bearing and *invisible* in code — a future "just add a second instance" or "deploy to Vercel" breaks retry, polling, and purge silently. Mitigation: a startup log line and README warning stating the constraint; if history/persistence ever lands (PRD "Later"), that work includes a real store and this ADR is superseded.
- Next.js is heavier than the product strictly needs (an Express app would do) — accepted, because team-familiarity beats minimalism inside a 1-week appetite, and the marginal weight is a container layer, not an operational burden.
- `next dev`'s hot-reload can recycle module state during development — engineer should expect in-memory batches to vanish on edit in dev; harmless, but worth a README note.
- Docker image must apt-install ffmpeg and pin a yt-dlp release; image rebuild is the yt-dlp update path (ADR-001 maintenance).

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Build inside the root dashboard app** | Explicitly prohibited (workspace infra vs product); also couples the product's deploy/breakage cadence (yt-dlp rebuilds) to an unrelated app. |
| **Express/Fastify API + separate static React frontend** | Two build pipelines and CORS/static-serving wiring for zero benefit over one Next.js app; less familiar shape than what the team already runs. |
| **Python (FastAPI) — yt-dlp's native language** | yt-dlp works identically as a CLI from Node; adopting a second language for the team would spend an innovation token on nothing an NFR demands. Classic résumé-driven temptation, declined. |
| **Serverless (Vercel/Lambda) deployment of the same Next.js app** | Kills in-memory state, can't guarantee binaries or 10-min executions, recycles processes mid-job. Incompatible with NFR-7's no-DB stance + ST-04 retry; would force adding Redis/S3 — *more* infrastructure to stay "serverless". |
| **Add Redis/SQLite to allow multi-instance** | Gold-plating against NFR-5 (≤5 users) and NFR-7 (no durable storage). The PRD's "Later" history feature is the trigger for revisiting, not v1. |
