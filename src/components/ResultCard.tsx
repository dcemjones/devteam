"use client";

// One result card per URL — anatomy per experience spec §5. Status is always text (+ a glyph
// shape), never colour alone. Failed variants use the exact microcopy table strings (§6).

import { useState } from "react";
import type { PublicItem } from "@/lib/types";

const PLATFORM_LABEL: Record<PublicItem["platform"], string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

export function formatDuration(sec: number | undefined): string | null {
  if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s} s`;
  return `${m} min ${s} s`;
}

/** Card status line per failed-card variant table (experience spec §5). */
export function statusLine(item: PublicItem): { text: string; detail?: string; retryable: boolean } {
  switch (item.status) {
    case "queued":
      return { text: "Queued", retryable: false };
    case "fetching":
    case "extracting":
    case "transcribing":
      return { text: "Processing…", retryable: false };
    case "done":
      return { text: "Done", retryable: false };
    case "no_speech":
      return { text: "No speech detected in this post's audio", retryable: false };
    case "failed": {
      const err = item.error;
      if (err?.code === "too_long") {
        return { text: "Post too long for v1 (max 15 min)", detail: err.message, retryable: false };
      }
      if (err?.code === "provider_error") {
        return { text: "Transcription failed", detail: err.message, retryable: true };
      }
      return {
        text: "Couldn't fetch this post",
        detail: err
          ? `${err.message}. Retry, or open the link to check it still exists.`
          : "Retry, or open the link to check it still exists.",
        retryable: err?.retryable ?? true,
      };
    }
  }
}

const COLLAPSE_LINE_THRESHOLD = 12;

interface Props {
  item: PublicItem;
  index: number;
  onRetry: (item: PublicItem) => void;
  onCopied: (item: PublicItem) => void;
}

export default function ResultCard({ item, index, onRetry, onCopied }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const s = statusLine(item);
  const duration = formatDuration(item.durationSec);

  const isDone = item.status === "done";
  const transcript = item.transcript ?? "";
  const lines = transcript.split("\n").length;
  const needsCollapse =
    isDone && (lines > COLLAPSE_LINE_THRESHOLD || transcript.length > 1500);
  const shownTranscript =
    needsCollapse && !expanded
      ? transcript.split("\n").slice(0, COLLAPSE_LINE_THRESHOLD).join("\n").slice(0, 1500) + "…"
      : transcript;

  const glyph =
    item.status === "done" ? "✓" :
    item.status === "failed" ? "✕" :
    item.status === "no_speech" ? "○" :
    item.status === "queued" ? "•" : "◌";

  const languageLabel = isDone
    ? item.detectedLanguage?.toLowerCase() === "english"
      ? "English (no translation applied)"
      : item.detectedLanguage
    : undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      onCopied(item);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (permissions) — leave button text unchanged.
    }
  }

  return (
    <li className="card" data-status={item.status} data-testid={`card-${index}`}>
      <h2>
        <span className="badge">{PLATFORM_LABEL[item.platform]}</span>
        <a href={item.url} target="_blank" rel="noreferrer noopener" title={item.url}>
          {item.url}
        </a>
      </h2>
      <p className="meta">
        <span className={item.status === "failed" ? "status-failed" : isDone ? "status-done" : undefined}>
          {glyph} {s.text}
        </span>
        {languageLabel ? <> · {languageLabel}</> : null}
        {isDone && duration ? <> · {duration}</> : null}
      </p>
      {s.detail ? <p className="detail">{s.detail}</p> : null}
      {isDone ? (
        <>
          <p className="transcript">{shownTranscript}</p>
          {needsCollapse ? (
            <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
              {expanded ? "Collapse transcript" : "Show full transcript"}
            </button>
          ) : null}
        </>
      ) : null}
      <div className="actions">
        {isDone ? (
          <button type="button" onClick={copy}>
            {copied ? "Copied" : "Copy transcript"}
          </button>
        ) : null}
        {item.status === "failed" && s.retryable ? (
          <button type="button" onClick={() => onRetry(item)}>
            Retry
          </button>
        ) : null}
        {item.duplicateRemoved ? <span className="dup-note">duplicate removed</span> : null}
      </div>
    </li>
  );
}
