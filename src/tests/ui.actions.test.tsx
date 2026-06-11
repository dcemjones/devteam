// @vitest-environment jsdom
// T-401 copy-to-clipboard + T-403 keyboard path (Ctrl/Cmd+Enter submit).

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import Page from "@/app/page";
import ResultCard from "@/components/ResultCard";
import type { PublicItem } from "@/lib/types";

const URL_A = "https://www.youtube.com/watch?v=aaaaa11111A";

function doneItem(transcript: string): PublicItem {
  return {
    id: "i1",
    url: URL_A,
    normalizedUrl: URL_A,
    platform: "youtube",
    status: "done",
    timings: {},
    transcript,
    detectedLanguage: "Spanish",
    durationSec: 90,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers(); // never let fake timers leak into the next test
});

describe("Copy transcript (T-401, ST-03)", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("copies the transcript, swaps the label to 'Copied' for ~2 s, fires the live-region callback", async () => {
    vi.useFakeTimers();
    const onCopied = vi.fn();
    render(
      <ul>
        <ResultCard item={doneItem("Hola amigos")} index={0} onRetry={() => {}} onCopied={onCopied} />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    // let the clipboard promise resolve under fake timers
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Hola amigos"));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(onCopied).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole("button", { name: "Copy transcript" })).toBeTruthy();
  });

  it("copies the FULL text even when the transcript is collapsed (spec §5)", async () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    render(
      <ul>
        <ResultCard item={doneItem(long)} index={0} onRetry={() => {}} onCopied={() => {}} />
      </ul>,
    );
    expect(screen.getByRole("button", { name: "Show full transcript" })).toBeTruthy(); // collapsed
    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(long));
  });

  it("Page announces 'Transcript copied' in the live region", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/batches") {
        return new Response(
          JSON.stringify({
            batchId: "b1",
            items: [{ id: "i1", url: URL_A, platform: "youtube", status: "queued", duplicateRemoved: false }],
            rejected: [],
            duplicatesRemoved: 0,
          }),
          { status: 202 },
        );
      }
      return new Response(
        JSON.stringify({
          id: "b1",
          createdAt: new Date().toISOString(),
          items: [doneItem("Hola amigos")],
          rejected: [],
          duplicatesRemoved: 0,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Page />);
    fireEvent.change(screen.getByLabelText("Post URLs"), { target: { value: URL_A } });
    fireEvent.click(screen.getByRole("button", { name: "Get transcripts" }));
    await screen.findByText("Hola amigos");

    fireEvent.click(screen.getByRole("button", { name: "Copy transcript" }));
    await waitFor(() =>
      expect(document.querySelector('[aria-live="polite"]')!.textContent).toContain("Transcript copied"),
    );
  });
});

describe("keyboard submit (T-403, NFR-8)", () => {
  it("Ctrl+Enter submits from the textarea", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: "Server busy — try again in a few minutes" }), { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Page />);
    const ta = screen.getByLabelText("Post URLs");
    fireEvent.change(ta, { target: { value: URL_A } });
    fireEvent.keyDown(ta, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/batches");
  });

  it("Cmd+Enter submits too; bare Enter does not submit", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: "Server busy — try again in a few minutes" }), { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Page />);
    const ta = screen.getByLabelText("Post URLs");
    fireEvent.change(ta, { target: { value: URL_A } });
    fireEvent.keyDown(ta, { key: "Enter" }); // plain Enter = newline, not submit
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
