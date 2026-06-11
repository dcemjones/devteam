// @vitest-environment jsdom
// T-303 (+T-301 client side): batch UI — input panel states, summary bar, destructive confirm.
// fetch is stubbed; statuses come from canned PublicBatch payloads.

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import Page from "@/app/page";
import type { PublicBatch, PublicItem } from "@/lib/types";

const URL_A = "https://www.youtube.com/watch?v=aaaaa11111A";
const URL_B = "https://www.youtube.com/watch?v=bbbbb22222B";

function pubItem(id: string, url: string, over: Partial<PublicItem> = {}): PublicItem {
  return { id, url, normalizedUrl: url, platform: "youtube", status: "queued", timings: {}, ...over };
}

function pubBatch(items: PublicItem[]): PublicBatch {
  return {
    id: "b1",
    createdAt: new Date().toISOString(),
    items,
    rejected: [],
    duplicatesRemoved: 0,
    expiresAt: new Date(Date.now() + 1000 * 60).toISOString(),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A Response body is single-use — build a fresh one per test.
const created202 = () =>
  json(
    {
      batchId: "b1",
      items: [
        { id: "i1", url: URL_A, platform: "youtube", status: "queued", duplicateRemoved: false },
        { id: "i2", url: URL_B, platform: "youtube", status: "queued", duplicateRemoved: false },
      ],
      rejected: [],
      duplicatesRemoved: 0,
    },
    202,
  );

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText("Post URLs") as HTMLTextAreaElement;
}
function submitBtn(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Get transcripts" }) as HTMLButtonElement;
}

describe("input panel: overflow state (ST-02 limit)", () => {
  it("shows 'n of 50' counter, the exact cap message, blocks submit, preserves input", () => {
    render(<Page />);
    const lines = Array.from({ length: 51 }, (_, i) => `https://youtu.be/vid${i}00000`).join("\n");
    fireEvent.change(textarea(), { target: { value: lines } });
    expect(screen.getByText("51 of 50")).toBeTruthy();
    expect(screen.getByText("Maximum 50 URLs per batch")).toBeTruthy();
    expect(submitBtn().disabled).toBe(true);
    expect(textarea().value).toBe(lines); // nothing lost
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("input panel: invalid lines (ST-01, A-UX5 all-or-nothing)", () => {
  it("names each bad line with the exact message, sends nothing, preserves input", async () => {
    render(<Page />);
    const input = `${URL_A}\nhttps://example.com/watch?v=zzz`;
    fireEvent.change(textarea(), { target: { value: input } });
    fireEvent.click(submitBtn());
    await waitFor(() =>
      expect(
        screen.getByText(/Line 2: .*Not a supported post URL — use Instagram, TikTok or YouTube/),
      ).toBeTruthy(),
    );
    expect(fetchMock).not.toHaveBeenCalled(); // client-side all-or-nothing: nothing submitted
    expect(textarea().value).toBe(input);
    expect(textarea().getAttribute("aria-describedby")).toBe("input-errors");
  });
});

describe("server busy (429 backpressure)", () => {
  it("shows the server message and preserves input", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Server busy — try again in a few minutes" }, 429));
    render(<Page />);
    fireEvent.change(textarea(), { target: { value: URL_A } });
    fireEvent.click(submitBtn());
    await screen.findByText("Server busy — try again in a few minutes");
    expect(textarea().value).toBe(URL_A);
  });
});

describe("batch lifecycle: summary bar + cards + destructive confirm (T-303)", () => {
  it("processing state: progress line, disabled export, collapsed input panel", async () => {
    fetchMock
      .mockImplementationOnce(async () => created202())
      .mockImplementation(async () =>
        json(
          pubBatch([
            pubItem("i1", URL_A, { status: "fetching" }),
            pubItem("i2", URL_B, {
              status: "failed",
              error: { step: "FETCH", code: "private_or_removed", message: "post is private or removed", retryable: true },
            }),
          ]),
        ),
      );
    render(<Page />);
    fireEvent.change(textarea(), { target: { value: `${URL_A}\n${URL_B}` } });
    fireEvent.click(submitBtn());

    await screen.findByText("Processing 1 of 2 — 1 failed so far");
    const exportBtn = screen.getByRole("button", { name: "Export CSV" }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
    expect(exportBtn.title).toBe("Available when the batch finishes");
    expect(screen.getByText("Processing batch — 'New batch' to start over")).toBeTruthy();
    expect(screen.queryByLabelText("Post URLs")).toBeNull(); // panel collapsed
  });

  it("settled mixed batch: '1 of 2 succeeded', export enabled, cards in input order; New batch confirms before clearing", async () => {
    fetchMock.mockImplementationOnce(async () => created202()).mockImplementation(async () =>
      json(
        pubBatch([
          pubItem("i1", URL_A, {
            status: "done",
            transcript: "Hello from fixture",
            detectedLanguage: "Spanish",
            durationSec: 90,
            costUsd: 0.012,
          }),
          pubItem("i2", URL_B, {
            status: "failed",
            error: { step: "FETCH", code: "private_or_removed", message: "post is private or removed", retryable: true },
          }),
        ]),
      ),
    );
    render(<Page />);
    fireEvent.change(textarea(), { target: { value: `${URL_A}\n${URL_B}` } });
    fireEvent.click(submitBtn());

    await screen.findByText("1 of 2 succeeded");
    expect(screen.getByText("Hello from fixture")).toBeTruthy();
    expect(screen.getByText(/Couldn't fetch this post/)).toBeTruthy();
    const csvLink = document.querySelector('a[href="/api/batches/b1/export.csv"]');
    expect(csvLink).toBeTruthy();
    // input order preserved (A-UX1)
    const cardLinks = Array.from(document.querySelectorAll(".card h2 a")).map((a) => a.getAttribute("href"));
    expect(cardLinks).toEqual([URL_A, URL_B]);
    // live region announced completion
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toContain("1 of 2 succeeded");

    // Destructive confirm (microcopy table, last row)
    fireEvent.click(screen.getByRole("button", { name: "New batch" }));
    const dialog = screen.getByRole("alertdialog", { name: "Start a new batch?" });
    expect(dialog.textContent).toContain(
      "Current results will be cleared and can't be recovered. Export the CSV first if you need them.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Hello from fixture")).toBeTruthy(); // nothing cleared

    fireEvent.click(screen.getByRole("button", { name: "New batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear and start new batch" }));
    expect(screen.queryByText("Hello from fixture")).toBeNull();
    expect(screen.getByLabelText("Post URLs")).toBeTruthy(); // back to the empty input state
  });

  it("duplicate note shows on the surviving card (ST-02)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(
          {
            batchId: "b1",
            items: [{ id: "i1", url: URL_A, platform: "youtube", status: "queued", duplicateRemoved: true }],
            rejected: [],
            duplicatesRemoved: 1,
          },
          202,
        ),
      )
      .mockResolvedValue(
        json(
          pubBatch([
            pubItem("i1", URL_A, {
              status: "done",
              transcript: "t",
              detectedLanguage: "Spanish",
              durationSec: 60,
              duplicateRemoved: true,
            }),
          ]),
        ),
      );
    render(<Page />);
    fireEvent.change(textarea(), { target: { value: `${URL_A}\n${URL_A}` } });
    fireEvent.click(submitBtn());
    await screen.findByText("duplicate removed");
    expect(screen.getByText("1 of 1 succeeded")).toBeTruthy();
  });
});
