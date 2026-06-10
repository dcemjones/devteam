// Sweeper (arch §8): runs at startup and every 10 min.
// 1. Purge audio of failed items older than the 60-min retry window.
// 2. Evict batches past their 24 h TTL (and their temp dirs).
// 3. Remove orphan temp dirs (crash leftovers) that belong to no live batch.

import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";
import { getState } from "./registry";
import { log } from "./logger";

export async function sweep(now = Date.now()): Promise<void> {
  const cfg = getConfig();
  const state = getState();

  for (const [batchId, batch] of state.batches) {
    if (Date.parse(batch.expiresAt) <= now) {
      state.batches.delete(batchId);
      await fs.rm(path.join(cfg.tmpRoot, batchId), { recursive: true, force: true }).catch(() => {});
      log("info", "batch_evicted", { batchId });
      continue;
    }
    for (const item of batch.items) {
      if (
        item.status === "failed" &&
        item.audioPath &&
        item.failedAt &&
        now - Date.parse(item.failedAt) >= cfg.failedAudioRetentionMs
      ) {
        await fs
          .rm(path.join(cfg.tmpRoot, batchId, item.id), { recursive: true, force: true })
          .catch(() => {});
        item.audioPath = undefined; // retry now transparently restarts from FETCH
        log("info", "failed_audio_purged", { batchId, itemId: item.id });
      }
    }
  }

  // Orphan dirs: anything under tmpRoot whose name is not a live batch id.
  try {
    const entries = await fs.readdir(cfg.tmpRoot, { withFileTypes: true });
    for (const e of entries) {
      if (!state.batches.has(e.name)) {
        await fs.rm(path.join(cfg.tmpRoot, e.name), { recursive: true, force: true }).catch(() => {});
        log("info", "orphan_tmp_removed", { dir: e.name });
      }
    }
  } catch {
    // tmpRoot may not exist yet — nothing to sweep.
  }
}

export function startSweeper(): void {
  const state = getState();
  if (state.sweeperTimer) return;
  void sweep();
  state.sweeperTimer = setInterval(() => void sweep(), getConfig().sweeperIntervalMs);
  state.sweeperTimer.unref?.();
}
