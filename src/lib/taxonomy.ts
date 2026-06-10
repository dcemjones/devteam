// yt-dlp stderr → failure taxonomy (T-202, arch §9). Raw stderr goes to logs only (NFR-6).
//
// NOTE (RK-7): these patterns are calibrated from documented yt-dlp error strings, not live
// failures — the sandbox cannot reach the platforms. `unknown` is the safe default.
// Recalibration is scoped into launch-blocking item LB-01.

import type { FailureCode } from "./types";

interface Rule {
  code: FailureCode;
  re: RegExp;
}

// Order matters: first match wins.
const RULES: Rule[] = [
  {
    code: "rate_limited",
    re: /(HTTP Error 429|too many requests|rate.?limit|IP( address)? is blocked|blocked it from display)/i,
  },
  {
    code: "login_required",
    re: /(login required|log in|sign in to confirm|use --cookies|cookies|requested content is not available, rate.?limit reached|account is private.*follow|authentication)/i,
  },
  {
    code: "geo_blocked",
    re: /(not available in your country|geo.?(restricted|blocked)|not made this video available in your)/i,
  },
  {
    code: "private_or_removed",
    re: /(private video|video unavailable|this video is unavailable|video has been removed|post unavailable|account has been terminated|no longer available|requested content is not available|404|not found|page not found|video is private|user has closed|content isn't available)/i,
  },
  {
    code: "extractor_error",
    re: /(unable to extract|unsupported url|no video formats|failed to parse json|kernel|extractor)/i,
  },
];

export function mapYtDlpStderr(stderr: string): FailureCode {
  for (const rule of RULES) {
    if (rule.re.test(stderr)) return rule.code;
  }
  return "unknown";
}

/** Best-known reason shown on the failed card (experience spec §5/§6). */
export const FAILURE_DETAIL: Record<FailureCode, string> = {
  private_or_removed: "post is private or removed",
  geo_blocked: "post is not available from this region",
  login_required: "the platform is asking for a login to view this post",
  rate_limited: "the platform is rate-limiting our requests",
  extractor_error: "the platform changed something and the fetcher needs an update",
  too_long: "", // too_long has dedicated card copy, not the "Couldn't fetch" template
  audio_processing_error: "the post's audio couldn't be processed",
  provider_error: "the transcription service returned an error — retrying usually fixes this.",
  unknown: "the post couldn't be downloaded",
};
