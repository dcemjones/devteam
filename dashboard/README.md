# Pipeline Dashboard

Next.js app that gives you a browser UI over the product build pipeline in this repo:

- **Status** (`/`) — live stage tracker parsed from `product/status.md`, with a progress bar and a form to record gate decisions (proceed / revise / kill) straight into `product/changelog.md`.
- **Artifacts** (`/artifacts`) — browse and read every markdown artifact the agents produce under `/product`.
- **Questions** (`/questions`) — open agent queries from `product/questions.md`, with a form to answer each one. Answers are committed back to the file, where the orchestrator picks them up.

The app reads the repo **live via the GitHub API on every request** — no redeploy needed when the pipeline pushes new artifacts. Answers and gate decisions are written back as commits.

## Deploy to Vercel

1. In Vercel: **Add New → Project**, import `dcemjones/devteam`.
2. Set **Root Directory** to `dashboard` (framework auto-detects as Next.js).
3. Add environment variables:

| Variable | Required | Notes |
|---|---|---|
| `GITHUB_TOKEN` | yes | Fine-grained PAT with **Contents: Read and write** on this repo. Needed to read a private repo and to commit answers/decisions. |
| `GITHUB_REPO` | no | Defaults to `dcemjones/devteam`. |
| `GITHUB_BRANCH` | no | Defaults to `main`. Point at another branch if the pipeline lives there. |
| `DASHBOARD_PASSWORD` | recommended | If set, the answer/gate forms require this key (entered once in the browser, stored locally). Without it, anyone who can reach the URL can write to your repo. |

4. Deploy. Also consider enabling Vercel **Deployment Protection** if the whole dashboard should be private, not just writes.

## Local development

```bash
cd dashboard
npm install
npm run dev
```

Locally (without `GITHUB_TOKEN`) the app reads and writes the working tree directly — handy while a pipeline run is in progress in the same checkout.
