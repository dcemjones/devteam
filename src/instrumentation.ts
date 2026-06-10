// Next.js instrumentation hook: runs once per server process start.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureBooted } = await import("./lib/boot");
    ensureBooted();
  }
}
