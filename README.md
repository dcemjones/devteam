# devteam — Product Build Workspace

A working environment for a ten-agent product pipeline that takes a request from idea to shipped code: discovery → strategy → definition → design → architecture → planning → build → QA → release → retro. You steer it; the agents do the specialist work; everything they produce lands in this repo as reviewable files.

## How to use it

Open this repo in Claude Code and kick off a build:

```
/build-product An internal tool that lets account managers see campaign
asset status across all client brands in one view. appetite: 3 weeks
```

The orchestrator (defined in [CLAUDE.md](CLAUDE.md)) runs intake, then hands the work stage by stage to the specialist agents in [.claude/agents/](.claude/agents/). For small asks, say "small" or set appetite ≤ 1 week and stages 1–3 collapse into one pass (QA is never skipped).

You can also invoke any agent directly, e.g. *"Use the qa-engineer subagent to audit /src against /product/03-definition/prd.md"*.

## Where everything lives

| You want to… | Look at |
|---|---|
| **Track progress** | [`product/status.md`](product/status.md) — live dashboard: current stage, % complete, blockers, what's waiting on you |
| **Answer agent queries** | [`product/questions.md`](product/questions.md) — agents log questions there; write your answer inline and tell the orchestrator to resume |
| **See outputs** | `product/00-intake/` … `product/10-retro/` — one folder per stage, plus working code in `src/` |
| **Review decisions** | [`product/changelog.md`](product/changelog.md) — every gate decision and artifact revision, with rationale |

## Hosted dashboard (Vercel)

[`dashboard/`](dashboard/) is a Next.js app that puts all of the above in the browser: a live stage tracker, an artifact reader, a form to answer open agent questions, and a form to record gate decisions — answers and decisions are committed straight back to this repo, where the orchestrator picks them up. It reads repo state via the GitHub API on every request, so it always reflects the latest push without redeploying.

Deploy: import this repo in Vercel, set **Root Directory** to `dashboard`, and add a `GITHUB_TOKEN` (plus optionally `DASHBOARD_PASSWORD`). Full instructions in [dashboard/README.md](dashboard/README.md).

## Your role: the five gates

The pipeline pauses for your decision (proceed / revise / kill) at five gates:

1. **Discovery** — is this the right problem?
2. **Strategy** — is it worth building?
3. **Definition** — is the PRD the right scope for the appetite?
4. **Architecture & Quality** — is the design sound / is the build releasable?
5. **Release** — ship it?

At each gate the orchestrator gives you a ≤10-line summary, the top risks, and a recommendation. "Kill" is a valid outcome — a cheap no at Discovery is a success.

## The agents

| Stage | Agent | Produces |
|---|---|---|
| 1 | discovery-researcher | Discovery brief (JTBD, evidence, opportunity tree) |
| 2 | product-strategist | Opportunity assessment (press release, RICE, build/buy/skip) |
| 3 | product-manager | PRD (appetite-scoped, Gherkin acceptance criteria) |
| 4 | ux-designer | Experience spec (five UI states, WCAG 2.2 AA) |
| 5 | solution-architect | Architecture + ADRs (C4, boring-tech bias, STRIDE) |
| 6 | delivery-planner | Delivery plan (vertical slices, risk-first, RAID) |
| 7 | implementation-engineer | Working code in `src/` + build log |
| 8 | qa-engineer | Test report with GO/NO-GO |
| 9 | release-manager | Launch plan + rollback runbook |
| 10 | retro-analyst | Retrospective + proposed edits to the agent files themselves |

## Conventions baked in

- Every claim in every artifact is **evidenced, ASSUMPTION, or OPEN** — no silent guesses.
- **Scope bends to appetite**, not the reverse; cuts happen on paper.
- **Walking skeleton first**: the riskiest end-to-end path is proven before polish.
- A QA **Blocker is an automatic NO-GO**; "GO-with-known-issues" needs a named accepter.
- Rollback steps exist **before** anything ships.

## Customising

- Add house conventions (stack defaults, naming, brand rules) to `CLAUDE.md` — every agent inherits them.
- Tighten or loosen gates by editing the pipeline table in `CLAUDE.md`.
- Point agents at external systems (Jira, etc.) by adding MCP tools to their `tools` frontmatter in `.claude/agents/`.
