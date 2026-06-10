// One-time process boot: env validation, the single-instance warning (ADR-003 mitigation),
// and the sweeper. Called from instrumentation.ts and defensively from API routes.

import { getConfig, validateEnv } from "./config";
import { getState } from "./registry";
import { log } from "./logger";
import { startSweeper } from "./sweeper";

export function ensureBooted(): void {
  const state = getState();
  if (state.startupLogged) return;
  state.startupLogged = true;

  const cfg = getConfig();
  const problems = validateEnv(cfg);
  for (const p of problems) {
    log("error", "env_invalid", { problem: p });
  }
  if (problems.length > 0 && process.env.NODE_ENV === "production") {
    // Fail loudly at boot rather than at the first user's expense (T-404).
    throw new Error(`Invalid environment: ${problems.join("; ")}`);
  }

  log("info", "startup", {
    mockProviders: cfg.mockProviders,
    tmpRoot: cfg.tmpRoot,
    poolConcurrency: cfg.poolConcurrency,
    constraint:
      "SINGLE-INSTANCE ONLY: all batch state is in this process's memory. " +
      "Deploy with min=max=1 instances; a second instance or serverless/scale-to-zero " +
      "deployment silently breaks polling, retry and media purge (ADR-003).",
  });
  startSweeper();
}
