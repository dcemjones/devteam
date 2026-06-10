// In-memory batch registry (arch §6-§7). Module-scope state pinned on globalThis so every
// Next.js route-handler chunk shares one instance. THIS BINDS THE APP TO EXACTLY ONE PROCESS
// (ADR-003): a second instance or serverless deploy breaks polling, retry and purge silently.

import { randomUUID } from "node:crypto";
import type { Batch, Item, Platform, PublicBatch, PublicItem } from "./types";
import { TERMINAL_STATUSES, isSettled } from "./types";
import { getConfig } from "./config";
import { WorkerPool } from "./pool";

interface AppState {
  batches: Map<string, Batch>;
  pool: WorkerPool;
  sweeperTimer?: ReturnType<typeof setInterval>;
  startupLogged: boolean;
}

const KEY = Symbol.for("itt.appState");

export function getState(): AppState {
  const g = globalThis as unknown as Record<symbol, AppState | undefined>;
  if (!g[KEY]) {
    g[KEY] = {
      batches: new Map(),
      pool: new WorkerPool(getConfig().poolConcurrency),
      startupLogged: false,
    };
  }
  return g[KEY]!;
}

/** Test hook: drop all state (fresh Map + pool). */
export function _resetState(): void {
  const g = globalThis as unknown as Record<symbol, AppState | undefined>;
  const s = g[KEY];
  if (s?.sweeperTimer) clearInterval(s.sweeperTimer);
  g[KEY] = undefined;
}

export interface NewItemInput {
  url: string;
  normalizedUrl: string;
  platform: Platform;
  duplicateRemoved: boolean;
}

export function createBatch(inputs: NewItemInput[], duplicatesRemoved: number): Batch {
  const cfg = getConfig();
  const now = Date.now();
  const batch: Batch = {
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    items: inputs.map((input) => ({
      id: randomUUID(),
      url: input.url,
      normalizedUrl: input.normalizedUrl,
      platform: input.platform,
      status: "queued",
      timings: {},
      ...(input.duplicateRemoved ? { duplicateRemoved: true } : {}),
    })),
    rejected: [],
    duplicatesRemoved,
    expiresAt: new Date(now + cfg.batchTtlMs).toISOString(),
  };
  getState().batches.set(batch.id, batch);
  return batch;
}

export function getBatch(id: string): Batch | undefined {
  const batch = getState().batches.get(id);
  if (!batch) return undefined;
  if (Date.parse(batch.expiresAt) <= Date.now()) {
    getState().batches.delete(id);
    return undefined;
  }
  return batch;
}

export function findItem(batch: Batch, itemId: string): Item | undefined {
  return batch.items.find((i) => i.id === itemId);
}

/** Live = at least one item not in a terminal state. Drives the 3-batch backpressure cap. */
export function liveBatchCount(): number {
  let n = 0;
  for (const b of getState().batches.values()) {
    if (!isSettled(b)) n++;
  }
  return n;
}

/** API shape: audioPath (server-internal temp path) and failedAt are never serialised. */
export function toPublicBatch(batch: Batch): PublicBatch {
  return {
    ...batch,
    items: batch.items.map((item): PublicItem => {
      const { audioPath: _a, failedAt: _f, ...pub } = item;
      return pub;
    }),
  };
}

export { TERMINAL_STATUSES, isSettled };
