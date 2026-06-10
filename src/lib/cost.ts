// NFR-9: costUsd = ceil(durationMin) × $0.006 (whisper-1 /audio/translations, ADR-002).

export const COST_PER_MINUTE_USD = 0.006;

export function costUsd(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const minutes = Math.ceil(durationSec / 60);
  // Avoid float dust (0.018000000000000002): price grid is 0.001-USD aligned.
  return Math.round(minutes * COST_PER_MINUTE_USD * 1000) / 1000;
}
