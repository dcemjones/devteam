// VALIDATE step — security-critical (SSRF, threat #1; command-injection pre-filter, threat #2).
// Strategy: strict https + no userinfo + no IP literal + EXACT hostname allowlist (no suffix
// matching, so lookalikes like `evil-youtube.com` or `youtube.com.evil.net` never pass) +
// per-platform post-path pattern (so open-redirect endpoints like youtube.com/redirect are
// rejected before anything is fetched). Isomorphic: used by both the API and the browser.

import type { Platform } from "./types";

export const INVALID_LINE_MESSAGE =
  "Not a supported post URL — use Instagram, TikTok or YouTube";

/**
 * Exact allowlist from architecture §10, plus `www.youtube.com`.
 * DEVIATION (logged in build log): arch §10 lists m.youtube.com but omits www.youtube.com —
 * the canonical browser URL for every YouTube video. Treated as an editorial slip; rejecting
 * www.youtube.com would fail ST-01's happy path.
 */
const HOST_PLATFORM: Record<string, Platform> = {
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "m.youtube.com": "youtube",
  "youtu.be": "youtube",
  "instagram.com": "instagram",
  "www.instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "www.tiktok.com": "tiktok",
  "vm.tiktok.com": "tiktok",
  "vt.tiktok.com": "tiktok",
};

export type UrlValidationFailure =
  | "not_a_url"
  | "not_https"
  | "has_userinfo"
  | "ip_literal"
  | "unsupported_host"
  | "not_a_post_url";

export type UrlValidation =
  | { ok: true; platform: Platform; normalizedUrl: string }
  | { ok: false; code: UrlValidationFailure; message: string };

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
// Hostnames that are all digits/hex/octal tricks (e.g. 0x7f000001, 2130706433, 017700000001).
const NUMERIC_HOST_RE = /^(0x[0-9a-f]+|[0-9]+)$/i;

function fail(code: UrlValidationFailure): UrlValidation {
  return { ok: false, code, message: INVALID_LINE_MESSAGE };
}

const YT_ID_RE = /^[A-Za-z0-9_-]{5,20}$/;

/** Post-path patterns per platform. Permissive about IDs, strict about shape. */
function matchPost(platform: Platform, hostname: string, u: URL): boolean {
  const segs = u.pathname.split("/").filter(Boolean);
  if (platform === "youtube") {
    if (hostname === "youtu.be") {
      return segs.length === 1 && YT_ID_RE.test(segs[0]);
    }
    if (segs[0] === "watch") {
      const v = u.searchParams.get("v");
      return segs.length === 1 && !!v && YT_ID_RE.test(v);
    }
    if ((segs[0] === "shorts" || segs[0] === "live") && segs.length === 2) {
      return YT_ID_RE.test(segs[1]);
    }
    return false;
  }
  if (platform === "instagram") {
    // /p/<code>/, /reel/<code>/, /reels/<code>/, /tv/<code>/, optionally /<username>/p/<code>/
    const kinds = new Set(["p", "reel", "reels", "tv"]);
    const idx = segs.findIndex((s) => kinds.has(s));
    if (idx === -1 || segs.length !== idx + 2) return false;
    return /^[A-Za-z0-9_-]{5,40}$/.test(segs[idx + 1]) && idx <= 1;
  }
  // tiktok
  if (hostname === "vm.tiktok.com" || hostname === "vt.tiktok.com") {
    return segs.length === 1 && /^[A-Za-z0-9]{4,20}$/.test(segs[0]);
  }
  // /@user/video/<id> or /@user/photo/<id>
  return (
    segs.length === 3 &&
    segs[0].startsWith("@") &&
    (segs[1] === "video" || segs[1] === "photo") &&
    /^\d{5,25}$/.test(segs[2])
  );
}

/** Query params that never change which post a URL points at — dropped during normalisation. */
const TRACKING_PARAMS = new Set([
  "feature", "si", "pp", "utm_source", "utm_medium", "utm_campaign", "utm_term",
  "utm_content", "igsh", "igshid", "img_index", "is_from_webapp", "sender_device",
  "web_id", "t", "_t", "_r", "share_app_id", "share_link_id",
]);

function normalize(platform: Platform, u: URL): string {
  const host = u.hostname.toLowerCase();
  if (platform === "youtube") {
    // Canonicalise every YouTube form to one shape so dedupe catches youtu.be vs watch?v=.
    const segs = u.pathname.split("/").filter(Boolean);
    let id: string | null = null;
    if (host === "youtu.be") id = segs[0];
    else if (segs[0] === "watch") id = u.searchParams.get("v");
    else id = segs[1]; // shorts/live
    return `https://www.youtube.com/watch?v=${id}`;
  }
  const out = new URL(`https://${host}${u.pathname}`);
  for (const [k, v] of u.searchParams) {
    if (!TRACKING_PARAMS.has(k)) out.searchParams.set(k, v);
  }
  let s = out.toString();
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

export function validateUrl(raw: string): UrlValidation {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return fail("not_a_url");

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return fail("not_a_url");
  }

  if (u.protocol !== "https:") return fail("not_https");
  if (u.username !== "" || u.password !== "") return fail("has_userinfo");

  const hostname = u.hostname.toLowerCase();
  if (
    IPV4_RE.test(hostname) ||
    NUMERIC_HOST_RE.test(hostname) ||
    hostname.startsWith("[") || // IPv6 literal
    hostname.includes(":")
  ) {
    return fail("ip_literal");
  }

  const platform = HOST_PLATFORM[hostname];
  if (!platform) return fail("unsupported_host");
  if (u.port !== "") return fail("unsupported_host"); // explicit ports are never platform post URLs

  if (!matchPost(platform, hostname, u)) return fail("not_a_post_url");

  return { ok: true, platform, normalizedUrl: normalize(platform, u) };
}

// ---------------------------------------------------------------------------
// Batch validation: ≤50 cap, all-or-nothing (A-UX5), dedupe by normalised URL.

export interface BatchLineError {
  /** 1-based line number within the submitted (non-empty) list. */
  line: number;
  url: string;
  message: string;
}

export type BatchValidation =
  | {
      ok: true;
      items: { url: string; normalizedUrl: string; platform: Platform; duplicateRemoved: boolean }[];
      duplicatesRemoved: number;
    }
  | { ok: false; code: "empty" | "over_limit" | "invalid_lines"; errors: BatchLineError[] };

export const OVER_LIMIT_MESSAGE = "Maximum 50 URLs per batch";

export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function validateBatch(urls: string[], maxUrls = 50): BatchValidation {
  const lines = urls.map((u) => u.trim()).filter((u) => u.length > 0);

  if (lines.length === 0) return { ok: false, code: "empty", errors: [] };
  if (lines.length > maxUrls) {
    return { ok: false, code: "over_limit", errors: [{ line: 0, url: "", message: OVER_LIMIT_MESSAGE }] };
  }

  const errors: BatchLineError[] = [];
  const seen = new Map<string, number>(); // normalizedUrl -> index in items
  const items: { url: string; normalizedUrl: string; platform: Platform; duplicateRemoved: boolean }[] = [];

  lines.forEach((url, i) => {
    const v = validateUrl(url);
    if (!v.ok) {
      errors.push({ line: i + 1, url, message: v.message });
      return;
    }
    const existing = seen.get(v.normalizedUrl);
    if (existing !== undefined) {
      items[existing].duplicateRemoved = true; // note goes on the surviving card (ST-02)
      return;
    }
    seen.set(v.normalizedUrl, items.length);
    items.push({ url, normalizedUrl: v.normalizedUrl, platform: v.platform, duplicateRemoved: false });
  });

  if (errors.length > 0) return { ok: false, code: "invalid_lines", errors };

  return { ok: true, items, duplicatesRemoved: lines.length - items.length };
}
