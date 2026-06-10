---
description: Run a product request through the full build pipeline
argument-hint: <product request, plus appetite if known e.g. "appetite: 2 weeks">
---

A new product request has arrived: $ARGUMENTS

Act as the Product Lead Orchestrator defined in CLAUDE.md.

1. Run Intake now: extract goal, target user, appetite, constraints and out-of-scope from the request. Ask up to 3 clarifying questions ONLY if the request is genuinely unbriefable; otherwise state your assumptions and proceed. Write `/product/00-intake/request-brief.md`, create `/product/status.md` and `/product/changelog.md`.
2. Decide mode: full pipeline, or fast-track if appetite ≤ 1 week / the user said "small".
3. Begin delegating stage by stage per CLAUDE.md, pausing at every ⛔ gate for my decision.
4. After every stage, update `/product/status.md` and give me a 3-line progress note.
