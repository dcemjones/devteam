// T-201: URL validation / hostname allowlist. SECURITY-CRITICAL (SSRF — threat #1).
// Adversarial cases: userinfo tricks, lookalike domains, private IPs, redirect endpoints,
// scheme games, IP-encoding games. Every rejection uses the single user-facing message.

import { describe, expect, it } from "vitest";
import {
  validateUrl,
  validateBatch,
  splitLines,
  INVALID_LINE_MESSAGE,
  OVER_LIMIT_MESSAGE,
} from "../validation";

function ok(url: string) {
  const v = validateUrl(url);
  expect(v.ok, `${url} should be ACCEPTED, got ${JSON.stringify(v)}`).toBe(true);
  return v as Extract<ReturnType<typeof validateUrl>, { ok: true }>;
}
function rejected(url: string, code?: string) {
  const v = validateUrl(url);
  expect(v.ok, `${url} should be REJECTED`).toBe(false);
  if (!v.ok) {
    expect(v.message).toBe(INVALID_LINE_MESSAGE);
    if (code) expect(v.code).toBe(code);
  }
}

describe("accepted post URLs (all three platforms)", () => {
  it("YouTube forms", () => {
    expect(ok("https://www.youtube.com/watch?v=dQw4w9WgXcQ").platform).toBe("youtube");
    expect(ok("https://youtube.com/watch?v=dQw4w9WgXcQ").platform).toBe("youtube");
    expect(ok("https://m.youtube.com/watch?v=dQw4w9WgXcQ").platform).toBe("youtube");
    expect(ok("https://youtu.be/dQw4w9WgXcQ").platform).toBe("youtube");
    expect(ok("https://www.youtube.com/shorts/dQw4w9WgXcQ").platform).toBe("youtube");
    expect(ok("https://www.youtube.com/live/dQw4w9WgXcQ").platform).toBe("youtube");
  });
  it("Instagram forms", () => {
    expect(ok("https://www.instagram.com/p/CxYzAb1cDe2/").platform).toBe("instagram");
    expect(ok("https://instagram.com/reel/CxYzAb1cDe2").platform).toBe("instagram");
    expect(ok("https://www.instagram.com/reels/CxYzAb1cDe2/").platform).toBe("instagram");
    expect(ok("https://www.instagram.com/tv/CxYzAb1cDe2/").platform).toBe("instagram");
    expect(ok("https://www.instagram.com/somecreator/p/CxYzAb1cDe2/").platform).toBe("instagram");
  });
  it("TikTok forms", () => {
    expect(ok("https://www.tiktok.com/@somecreator/video/7234567890123456789").platform).toBe("tiktok");
    expect(ok("https://tiktok.com/@some.creator/photo/7234567890123456789").platform).toBe("tiktok");
    expect(ok("https://vm.tiktok.com/ZMabcDEF1/").platform).toBe("tiktok");
    expect(ok("https://vt.tiktok.com/ZSabcDEF2").platform).toBe("tiktok");
  });
  it("tolerates tracking params and uppercase hosts", () => {
    ok("https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ");
    ok("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&si=AbC123");
    ok("https://www.instagram.com/reel/CxYzAb1cDe2/?igsh=xyz&utm_source=share");
  });
});

describe("SSRF: userinfo tricks", () => {
  it("rejects credentials smuggling an allowlisted host into userinfo", () => {
    rejected("https://www.youtube.com@evil.com/watch?v=dQw4w9WgXcQ"); // real host is evil.com
    rejected("https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ", "has_userinfo");
    rejected("https://youtube.com:secret@169.254.169.254/latest/meta-data/");
  });
});

describe("SSRF: lookalike and suffix domains", () => {
  it("rejects lookalikes — exact-match allowlist only", () => {
    rejected("https://evil-youtube.com/watch?v=dQw4w9WgXcQ", "unsupported_host");
    rejected("https://youtube.com.evil.net/watch?v=dQw4w9WgXcQ", "unsupported_host");
    rejected("https://wwwyoutube.com/watch?v=dQw4w9WgXcQ", "unsupported_host");
    rejected("https://youtu.be.evil.com/dQw4w9WgXcQ", "unsupported_host");
    rejected("https://xn--youtube-w1a.com/watch?v=dQw4w9WgXcQ", "unsupported_host");
    rejected("https://notinstagram.com/p/CxYzAb1cDe2/", "unsupported_host");
    rejected("https://tiktok.com.attacker.io/@x/video/7234567890123456789", "unsupported_host");
  });
  it("rejects allowlisted hosts with explicit ports", () => {
    rejected("https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ");
  });
});

describe("SSRF: IP literals and private addresses", () => {
  it("rejects IPv4 / metadata / loopback / private ranges", () => {
    rejected("https://169.254.169.254/latest/meta-data/", "ip_literal");
    rejected("https://127.0.0.1/watch?v=dQw4w9WgXcQ", "ip_literal");
    rejected("https://10.0.0.5/p/CxYzAb1cDe2/", "ip_literal");
    rejected("https://192.168.1.1/", "ip_literal");
  });
  it("rejects IPv6 literals", () => {
    rejected("https://[::1]/watch?v=dQw4w9WgXcQ", "ip_literal");
    rejected("https://[fd00::1]/p/abc12/", "ip_literal");
  });
  it("rejects decimal/hex IP encodings", () => {
    rejected("https://2130706433/watch?v=dQw4w9WgXcQ", "ip_literal"); // 127.0.0.1 decimal
    rejected("https://0x7f000001/watch?v=dQw4w9WgXcQ", "ip_literal");
  });
});

describe("SSRF: scheme and redirect games", () => {
  it("rejects non-https schemes", () => {
    rejected("http://www.youtube.com/watch?v=dQw4w9WgXcQ", "not_https");
    rejected("ftp://www.youtube.com/watch?v=dQw4w9WgXcQ", "not_https");
    rejected("javascript:alert(1)", "not_https");
    rejected("file:///etc/passwd", "not_https");
  });
  it("rejects allowlisted-host paths that are not post URLs (open-redirect endpoints)", () => {
    rejected("https://www.youtube.com/redirect?q=http://169.254.169.254/", "not_a_post_url");
    rejected("https://www.youtube.com/", "not_a_post_url");
    rejected("https://www.instagram.com/accounts/login/?next=//evil.com", "not_a_post_url");
    rejected("https://www.tiktok.com/login", "not_a_post_url");
    rejected("https://www.youtube.com/results?search_query=x", "not_a_post_url");
  });
  // NOTE: HTTP-level redirects followed BY yt-dlp are out of validation's reach — that residual
  // risk is mitigated at deploy time (no reachable internal services / metadata endpoint
  // blocked), per architecture §10. Documented in the README and launch checklist.
});

describe("garbage input", () => {
  it("rejects non-URLs and embedded whitespace", () => {
    rejected("not a url at all", "not_a_url");
    rejected("youtube.com/watch?v=dQw4w9WgXcQ", "not_a_url"); // schemeless
    rejected("", "not_a_url");
    rejected("https://www.youtube.com/watch?v=dQw4 w9WgXcQ", "not_a_url");
  });
});

describe("batch validation (T-301 logic): cap, all-or-nothing, dedupe", () => {
  const valid = (n: number) => `https://www.youtube.com/watch?v=vid${String(n).padStart(8, "0")}`;

  it("rejects >50 with the exact message and processes nothing", () => {
    const v = validateBatch(Array.from({ length: 51 }, (_, i) => valid(i)));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("over_limit");
      expect(v.errors[0].message).toBe(OVER_LIMIT_MESSAGE);
    }
  });

  it("accepts exactly 50", () => {
    const v = validateBatch(Array.from({ length: 50 }, (_, i) => valid(i)));
    expect(v.ok).toBe(true);
  });

  it("any invalid line blocks the whole submit, naming each bad line (A-UX5)", () => {
    const v = validateBatch([valid(1), "https://example.com/x", valid(2), "garbage"]);
    expect(v.ok).toBe(false);
    if (!v.ok && v.code === "invalid_lines") {
      expect(v.errors.map((e) => e.line)).toEqual([2, 4]);
      expect(v.errors.every((e) => e.message === INVALID_LINE_MESSAGE)).toBe(true);
    }
  });

  it("dedupes literal duplicates and marks the surviving item", () => {
    const v = validateBatch([valid(1), valid(1), valid(2)]);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.items).toHaveLength(2);
      expect(v.duplicatesRemoved).toBe(1);
      expect(v.items[0].duplicateRemoved).toBe(true);
      expect(v.items[1].duplicateRemoved).toBe(false);
    }
  });

  it("dedupes across URL forms: youtu.be vs watch?v= vs tracking params", () => {
    const v = validateBatch([
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    ]);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.items).toHaveLength(1);
      expect(v.duplicatesRemoved).toBe(2);
    }
  });

  it("ignores empty lines and trims whitespace", () => {
    expect(splitLines(`\n  ${valid(1)}  \n\n${valid(2)}\r\n`)).toHaveLength(2);
    const v = validateBatch([` ${valid(1)} `, ""]);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.items).toHaveLength(1);
  });

  it("rejects an empty submission", () => {
    const v = validateBatch([]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("empty");
  });
});
