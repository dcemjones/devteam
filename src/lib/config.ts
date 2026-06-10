// All knobs in one place. Caps are parameterised per PRD OPEN-2/OPEN-4 (copy derives from these).

export interface Config {
  /** MOCK_PROVIDERS=1 selects the fixture Fetcher/Transcriber (T-102 / M0 contingency). */
  mockProviders: boolean;
  openaiApiKey: string | undefined;
  openaiBaseUrl: string;
  /** Root for per-item temp dirs: <tmpRoot>/<batchId>/<itemId>/ */
  tmpRoot: string;
  ytDlpPath: string;
  ffmpegPath: string;
  maxUrlsPerBatch: number;
  maxDurationSec: number;
  /** Global worker concurrency across all batches (arch §5). */
  poolConcurrency: number;
  /** Max live (unsettled) batches before 429 backpressure. */
  maxLiveBatches: number;
  /** Failed items keep their audio this long so retry can resume without refetching (arch §8). */
  failedAudioRetentionMs: number;
  batchTtlMs: number;
  sweeperIntervalMs: number;
  /** OpenAI request timeout + in-step retry count (arch §9). */
  openaiTimeoutMs: number;
  openaiMaxRetries: number;
  /** Whisper file limit safety margin: re-encode if bigger than this (arch §4 step 3). */
  reencodeThresholdBytes: number;
  /** $/audio-minute for whisper-1 /audio/translations (NFR-9, ADR-002). */
  costPerMinuteUsd: number;
  /** Artificial latency for fixture providers so the UI visibly moves through states. */
  fixtureDelayMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function getConfig(): Config {
  return {
    mockProviders: process.env.MOCK_PROVIDERS === "1",
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    tmpRoot: process.env.ITT_TMP_DIR ?? "/tmp/itt",
    ytDlpPath: process.env.YTDLP_PATH ?? "yt-dlp",
    ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
    maxUrlsPerBatch: envInt("ITT_MAX_URLS", 50),
    maxDurationSec: envInt("ITT_MAX_DURATION_SEC", 900),
    poolConcurrency: envInt("ITT_POOL_CONCURRENCY", 4),
    maxLiveBatches: envInt("ITT_MAX_LIVE_BATCHES", 3),
    failedAudioRetentionMs: envInt("ITT_FAILED_AUDIO_RETENTION_MS", 60 * 60 * 1000),
    batchTtlMs: envInt("ITT_BATCH_TTL_MS", 24 * 60 * 60 * 1000),
    sweeperIntervalMs: envInt("ITT_SWEEPER_INTERVAL_MS", 10 * 60 * 1000),
    openaiTimeoutMs: envInt("ITT_OPENAI_TIMEOUT_MS", 120_000),
    openaiMaxRetries: envInt("ITT_OPENAI_MAX_RETRIES", 2),
    reencodeThresholdBytes: envInt("ITT_REENCODE_THRESHOLD_BYTES", 24 * 1024 * 1024),
    costPerMinuteUsd: 0.006,
    fixtureDelayMs: envInt("ITT_FIXTURE_DELAY_MS", 300),
  };
}

/**
 * Boot-time validation (T-404): fail loudly, not at the first user's expense.
 * In mock mode the OpenAI key and binaries are not required.
 */
export function validateEnv(cfg: Config = getConfig()): string[] {
  const problems: string[] = [];
  if (!cfg.mockProviders && !cfg.openaiApiKey) {
    problems.push("OPENAI_API_KEY is not set (required unless MOCK_PROVIDERS=1)");
  }
  return problems;
}
