// Structured JSON-line logs to stdout (NFR-6). No user PII exists to log; the OpenAI key must never appear.

type LogFields = Record<string, unknown>;

const SECRET_KEYS = /key|token|secret|authorization|password/i;

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : v;
  }
  return out;
}

export function log(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  });
  // Single stdout write per line; the host platform retains ~30 days (PRD assumption).
  console.log(line);
}
