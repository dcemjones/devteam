// Deterministic fixture scenarios for MOCK_PROVIDERS=1 (T-102, M0 sandbox contingency).
// A URL opts into a scenario by containing one of these markers anywhere in it (e.g. a YouTube
// id of "fix-private-1"); anything else is a plain success with stable pseudo-random duration.

export type FixtureScenario =
  | "private"        // FETCH fails: private_or_removed
  | "geoblock"       // FETCH fails: geo_blocked
  | "loginwall"      // FETCH fails: login_required
  | "ratelimit"      // FETCH fails: rate_limited
  | "extractor"      // FETCH fails: extractor_error
  | "toolong"        // rejected at FETCH: 22-minute post
  | "flakyfetch"     // FETCH fails once per URL, then succeeds (retry demo)
  | "silent"         // pipeline succeeds, empty transcript -> no_speech
  | "english"        // English source -> "English (no translation applied)"
  | "sttflaky"       // TRANSCRIBE fails once per URL, then succeeds (retry-from-step demo)
  | "sttfail"        // TRANSCRIBE always fails
  | "success";

export function scenarioFor(url: string): FixtureScenario {
  const u = url.toLowerCase();
  for (const s of [
    "private", "geoblock", "loginwall", "ratelimit", "extractor", "toolong",
    "flakyfetch", "silent", "english", "sttflaky", "sttfail",
  ] as const) {
    if (u.includes(s)) return s;
  }
  return "success";
}

/** Stable small hash so fixture durations/transcripts are deterministic per URL. */
export function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface CannedTranslation {
  /** Shape mirrors whisper-1 /audio/translations response_format=verbose_json. */
  task: "translate";
  language: string;
  duration: number;
  text: string;
}

const SPANISH_TEXT =
  "Hi everyone! Today I want to talk about the new collection we are launching with the brand. " +
  "I have been trying these products for two weeks and I am going to tell you honestly what I think. " +
  "Remember this video is a paid collaboration, the link is in my bio with a ten percent discount code.";

const PORTUGUESE_TEXT =
  "Good morning guys! I received this kit from the brand and I promised I would show you the routine. " +
  "I use the serum at night, twice a week, and the moisturizer every day. " +
  "This post is an advertisement, as always I leave everything marked here for you.";

const ENGLISH_TEXT =
  "Hey friends, quick unboxing today. The brand sent me their spring line and honestly the packaging " +
  "alone is worth the price. Use my code SPRING10 for ten percent off — this video is sponsored.";

export function cannedTranslation(url: string, durationSec: number): CannedTranslation {
  const s = scenarioFor(url);
  if (s === "silent") return { task: "translate", language: "", duration: durationSec, text: "  " };
  if (s === "english") return { task: "translate", language: "english", duration: durationSec, text: ENGLISH_TEXT };
  const pt = stableHash(url) % 2 === 0;
  return {
    task: "translate",
    language: pt ? "portuguese" : "spanish",
    duration: durationSec,
    text: pt ? PORTUGUESE_TEXT : SPANISH_TEXT,
  };
}

export function fixtureDurationSec(url: string): number {
  if (scenarioFor(url) === "toolong") return 22 * 60; // "This post is 22 minutes."
  return 45 + (stableHash(url) % 240); // 45 s .. ~4 min 45 s
}
