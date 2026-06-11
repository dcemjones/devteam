// T-202: yt-dlp stderr → failure taxonomy. Patterns are calibrated from DOCUMENTED yt-dlp
// error strings (RK-7) — these tests pin the mapping; recalibration against live stderr is LB-01.

import { describe, expect, it } from "vitest";
import { mapYtDlpStderr } from "../taxonomy";

describe("mapYtDlpStderr", () => {
  it("private/removed posts", () => {
    expect(mapYtDlpStderr("ERROR: [youtube] abc: Private video")).toBe("private_or_removed");
    expect(mapYtDlpStderr("ERROR: [youtube] abc: Video unavailable")).toBe("private_or_removed");
    expect(mapYtDlpStderr("ERROR: [tiktok] 123: This post is no longer available")).toBe("private_or_removed");
    expect(mapYtDlpStderr("ERROR: [instagram] xyz: HTTP Error 404: Not Found")).toBe("private_or_removed");
    expect(mapYtDlpStderr("ERROR: [generic] This content isn't available right now")).toBe("private_or_removed");
  });

  it("geo blocks", () => {
    expect(mapYtDlpStderr("ERROR: The uploader has not made this video available in your country")).toBe("geo_blocked");
    expect(mapYtDlpStderr("ERROR: [youtube] abc: This video is geo-restricted")).toBe("geo_blocked");
  });

  it("login walls", () => {
    expect(mapYtDlpStderr("ERROR: [instagram] xyz: Login required to access this content. Use --cookies")).toBe("login_required");
    expect(mapYtDlpStderr("ERROR: [youtube] Sign in to confirm you're not a bot")).toBe("login_required");
  });

  it("rate limiting / IP blocks (checked before login_required so 429s never read as login walls)", () => {
    expect(mapYtDlpStderr("ERROR: HTTP Error 429: Too Many Requests")).toBe("rate_limited");
    expect(mapYtDlpStderr("ERROR: [tiktok] Your IP address is blocked")).toBe("rate_limited");
  });

  it("extractor breakage (the 'rebuild the container' signal, arch §12)", () => {
    expect(mapYtDlpStderr("ERROR: [instagram] Unable to extract shared data")).toBe("extractor_error");
    expect(mapYtDlpStderr("ERROR: Unsupported URL: https://…")).toBe("extractor_error");
    expect(mapYtDlpStderr("ERROR: [tiktok] 123: No video formats found!")).toBe("extractor_error");
  });

  it("unknown is the safe default (RK-7)", () => {
    expect(mapYtDlpStderr("ERROR: something entirely new from a yt-dlp release")).toBe("unknown");
    expect(mapYtDlpStderr("")).toBe("unknown");
  });
});
