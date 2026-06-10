// Child-process helper. Threat #2 (command injection): argv arrays only, shell NEVER enabled,
// and callers put `--` before any user-controlled URL.

import { spawn } from "node:child_process";

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type SpawnFn = (
  bin: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<SpawnResult>;

export const spawnCapture: SpawnFn = (bin, args, opts = {}) => {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  return new Promise((resolve, reject) => {
    // `shell: false` is the default; stated explicitly because it is load-bearing.
    const child = spawn(bin, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err); // binary missing etc.
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
};
