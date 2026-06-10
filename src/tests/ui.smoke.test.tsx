// @vitest-environment jsdom
// UI smoke render (delivery plan: "UI verified by building + a smoke render").
// Checks the empty/first-run state and every result-card state against the microcopy table.

import React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import Page from "@/app/page";
import ResultCard, { statusLine, formatDuration } from "@/components/ResultCard";
import type { PublicItem } from "@/lib/types";

afterEach(cleanup);

function item(overrides: Partial<PublicItem>): PublicItem {
  return {
    id: "i1",
    url: "https://www.youtube.com/watch?v=abc12345",
    normalizedUrl: "https://www.youtube.com/watch?v=abc12345",
    platform: "youtube",
    status: "queued",
    timings: {},
    ...overrides,
  };
}

const noop = () => {};

describe("empty / first-run state (ST-01)", () => {
  it("shows label, helper text, counter and a disabled submit button; no cards", () => {
    render(<Page />);
    expect(screen.getByLabelText("Post URLs")).toBeTruthy();
    expect(
      screen.getByText("Paste Instagram, TikTok or YouTube post URLs, one per line"),
    ).toBeTruthy();
    expect(screen.getByText("0 of 50")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Get transcripts" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(document.querySelector(".cards")).toBeNull();
    // live region present
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});

describe("result card states (experience spec §5)", () => {
  it("done card: platform badge, link, language, duration, transcript, copy button", () => {
    render(
      <ul>
        <ResultCard
          item={item({
            status: "done",
            transcript: "Hello world",
            detectedLanguage: "Portuguese",
            durationSec: 161,
          })}
          index={0}
          onRetry={noop}
          onCopied={noop}
        />
      </ul>,
    );
    expect(screen.getByText("YouTube")).toBeTruthy();
    expect(screen.getByText(/Done/)).toBeTruthy();
    expect(screen.getByText(/Portuguese/)).toBeTruthy();
    expect(screen.getByText(/2 min 41 s/)).toBeTruthy();
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy transcript" })).toBeTruthy();
  });

  it("English-source card shows 'English (no translation applied)' (ST-03)", () => {
    render(
      <ul>
        <ResultCard
          item={item({ status: "done", transcript: "Hi", detectedLanguage: "English", durationSec: 60 })}
          index={0}
          onRetry={noop}
          onCopied={noop}
        />
      </ul>,
    );
    expect(screen.getByText(/English \(no translation applied\)/)).toBeTruthy();
  });

  it("unfetchable card: exact status, reason, Retry (ST-04)", () => {
    render(
      <ul>
        <ResultCard
          item={item({
            status: "failed",
            error: {
              step: "FETCH",
              code: "private_or_removed",
              message: "post is private or removed",
              retryable: true,
            },
          })}
          index={0}
          onRetry={noop}
          onCopied={noop}
        />
      </ul>,
    );
    expect(screen.getByText(/Couldn't fetch this post/)).toBeTruthy();
    expect(
      screen.getByText("post is private or removed. Retry, or open the link to check it still exists."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("provider-failure card: 'Transcription failed' with Retry, never 'Couldn't fetch'", () => {
    render(
      <ul>
        <ResultCard
          item={item({
            status: "failed",
            error: {
              step: "TRANSCRIBE_TRANSLATE",
              code: "provider_error",
              message: "The transcription service returned an error — retrying usually fixes this.",
              retryable: true,
            },
          })}
          index={0}
          onRetry={noop}
          onCopied={noop}
        />
      </ul>,
    );
    expect(screen.getByText(/Transcription failed/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't fetch this post/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("too-long card: exact status, duration detail, NO retry (ST-04/NFR-1)", () => {
    render(
      <ul>
        <ResultCard
          item={item({
            status: "failed",
            durationSec: 1320,
            error: {
              step: "FETCH",
              code: "too_long",
              message: "This post is 22 minutes. Shorter posts up to 15 minutes are supported.",
              retryable: false,
            },
          })}
          index={0}
          onRetry={noop}
          onCopied={noop}
        />
      </ul>,
    );
    expect(screen.getByText(/Post too long for v1 \(max 15 min\)/)).toBeTruthy();
    expect(screen.getByText(/This post is 22 minutes/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("no-speech card: exact copy, no transcript, no retry (ST-04)", () => {
    render(
      <ul>
        <ResultCard item={item({ status: "no_speech" })} index={0} onRetry={noop} onCopied={noop} />
      </ul>,
    );
    expect(screen.getByText(/No speech detected in this post's audio/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy transcript" })).toBeNull();
  });

  it("duplicate note appears on the surviving card (ST-02)", () => {
    render(
      <ul>
        <ResultCard
          item={item({ status: "queued", duplicateRemoved: true })}
          index={0}
          onRetry={noop}
          onCopied={noop}
        />
      </ul>,
    );
    expect(screen.getByText("duplicate removed")).toBeTruthy();
  });

  it("long transcripts collapse behind 'Show full transcript' (A-UX3)", () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    render(
      <ul>
        <ResultCard
          item={item({ status: "done", transcript: long, detectedLanguage: "Spanish", durationSec: 90 })}
          index={0}
          onRetry={noop}
          onCopied={noop}
        />
      </ul>,
    );
    expect(screen.getByRole("button", { name: "Show full transcript" })).toBeTruthy();
    expect(screen.queryByText(/line 20/)).toBeNull();
  });
});

describe("pure helpers", () => {
  it("formatDuration", () => {
    expect(formatDuration(161)).toBe("2 min 41 s");
    expect(formatDuration(41)).toBe("41 s");
    expect(formatDuration(undefined)).toBeNull();
  });
  it("statusLine maps every processing status to 'Processing…'", () => {
    for (const s of ["fetching", "extracting", "transcribing"] as const) {
      expect(statusLine(item({ status: s })).text).toBe("Processing…");
    }
    expect(statusLine(item({ status: "queued" })).text).toBe("Queued");
  });
});
