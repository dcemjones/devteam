"use client";

// The one page (experience spec §4): header, input panel, batch summary bar, results list,
// visually hidden polite live region. Polls /api/batches/:id every 2 s until the batch settles.

import { useCallback, useEffect, useRef, useState } from "react";
import ResultCard from "@/components/ResultCard";
import type { PublicBatch, PublicItem } from "@/lib/types";
import { isSettled } from "@/lib/types";
import { splitLines, validateBatch, OVER_LIMIT_MESSAGE, type BatchLineError } from "@/lib/validation";

const MAX_URLS = 50;
const POLL_MS = 2000;
const BATCH_GONE_MESSAGE = "This batch is no longer available — please resubmit";

function succeededCount(batch: PublicBatch): number {
  // no-speech counts as completed, not failed (ST-04)
  return batch.items.filter((i) => i.status === "done" || i.status === "no_speech").length;
}
function failedCount(batch: PublicBatch): number {
  return batch.items.filter((i) => i.status === "failed").length;
}
function settledCount(batch: PublicBatch): number {
  return succeededCount(batch) + failedCount(batch);
}

export default function Page() {
  const [input, setInput] = useState("");
  const [batch, setBatch] = useState<PublicBatch | null>(null);
  const [lineErrors, setLineErrors] = useState<BatchLineError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const prevStatuses = useRef<Map<string, PublicItem["status"]>>(new Map());
  const announcedSettled = useRef(false);

  const lines = splitLines(input);
  const overLimit = lines.length > MAX_URLS;
  const settled = batch !== null && isSettled(batch);
  const processing = batch !== null && !settled;

  const announce = useCallback((msg: string) => {
    setAnnouncement((prev) => (prev === msg ? msg + " " : msg));
  }, []);

  const applyBatch = useCallback(
    (next: PublicBatch) => {
      // Live-region announcements for status transitions (experience spec §7).
      const msgs: string[] = [];
      next.items.forEach((item, idx) => {
        const prev = prevStatuses.current.get(item.id);
        if (prev !== item.status) {
          prevStatuses.current.set(item.id, item.status);
          if (item.status === "done") msgs.push(`URL ${idx + 1}: done`);
          else if (item.status === "no_speech") msgs.push(`URL ${idx + 1}: no speech detected`);
          else if (item.status === "failed")
            msgs.push(
              `URL ${idx + 1}: failed — ${
                item.error?.code === "provider_error" ? "transcription failed" : "couldn't fetch this post"
              }`,
            );
        }
      });
      if (isSettled(next) && !announcedSettled.current) {
        announcedSettled.current = true;
        msgs.push(`${succeededCount(next)} of ${next.items.length} succeeded`);
      }
      if (msgs.length > 0) announce(msgs.join(". "));
      setBatch(next);
    },
    [announce],
  );

  const refreshBatch = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/batches/${id}`, { cache: "no-store" });
        if (res.status === 404) {
          setBatch(null);
          setSubmitError(BATCH_GONE_MESSAGE);
          return;
        }
        if (res.ok) applyBatch((await res.json()) as PublicBatch);
      } catch {
        // transient poll failure: keep last state, next tick retries
      }
    },
    [applyBatch],
  );

  // 2 s polling that stops when the batch settles.
  useEffect(() => {
    if (!batch || isSettled(batch)) return;
    const t = setTimeout(() => void refreshBatch(batch.id), POLL_MS);
    return () => clearTimeout(t);
  }, [batch, refreshBatch]);

  async function submit() {
    setSubmitError(null);
    setLineErrors([]);
    if (lines.length === 0 || overLimit) return;

    const v = validateBatch(lines, MAX_URLS);
    if (!v.ok) {
      if (v.code === "invalid_lines") setLineErrors(v.errors);
      else if (v.code === "over_limit") setSubmitError(OVER_LIMIT_MESSAGE);
      return; // nothing is sent for processing; input preserved (ST-01/ST-02)
    }

    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: lines }),
      });
      if (res.status === 429) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSubmitError(body?.error ?? "Server busy — try again in a few minutes");
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; errors?: BatchLineError[] }
          | null;
        if (body?.errors?.length) setLineErrors(body.errors);
        else setSubmitError(body?.error ?? "Submission rejected");
        return;
      }
      if (!res.ok) {
        setSubmitError("Something went wrong submitting the batch — try again");
        return;
      }
      const created = (await res.json()) as { batchId: string };
      prevStatuses.current = new Map();
      announcedSettled.current = false;
      setInput(""); // textarea content cleared into the cards (spec §4)
      await refreshBatch(created.batchId);
    } catch {
      setSubmitError("Something went wrong submitting the batch — try again");
    }
  }

  function requestNewBatch() {
    if (!batch) return;
    setConfirmOpen(true); // always confirm: clearing results is the page's only destructive action
  }

  function confirmNewBatch() {
    setConfirmOpen(false);
    setBatch(null);
    setSubmitError(null);
    setLineErrors([]);
    prevStatuses.current = new Map();
    announcedSettled.current = false;
  }

  async function retry(item: PublicItem) {
    if (!batch) return;
    try {
      const res = await fetch(`/api/batches/${batch.id}/items/${item.id}/retry`, { method: "POST" });
      if (res.status === 404) {
        setBatch(null);
        setSubmitError(BATCH_GONE_MESSAGE);
        return;
      }
      announcedSettled.current = false;
      await refreshBatch(batch.id);
    } catch {
      // next poll will reconcile
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  const summaryText = batch
    ? settled
      ? `${succeededCount(batch)} of ${batch.items.length} succeeded`
      : `Processing ${settledCount(batch)} of ${batch.items.length}` +
        (failedCount(batch) > 0 ? ` — ${failedCount(batch)} failed so far` : "")
    : "";

  return (
    <main>
      <h1>Influencer Transcript Translator</h1>
      <p className="tagline">
        Paste public post URLs and read what was said, in English. Transcripts are not stored —
        export the CSV if you need to keep them.
      </p>

      {/* Region: input panel */}
      {batch === null ? (
        <section aria-label="Submit URLs">
          <label htmlFor="urls">Post URLs</label>
          <textarea
            id="urls"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby={
              lineErrors.length > 0 || overLimit || submitError ? "input-errors" : "urls-helper"
            }
            aria-invalid={lineErrors.length > 0 || overLimit}
          />
          <p className="helper" id="urls-helper">
            Paste Instagram, TikTok or YouTube post URLs, one per line
          </p>
          <div className="input-row">
            <button
              type="button"
              className="primary"
              onClick={() => void submit()}
              disabled={lines.length === 0 || overLimit}
            >
              Get transcripts
            </button>
            <span className={overLimit ? "counter over" : "counter"}>
              {lines.length} of {MAX_URLS}
            </span>
          </div>
          <div id="input-errors">
            {overLimit ? <p className="error-text">{OVER_LIMIT_MESSAGE}</p> : null}
            {submitError ? <p className="error-text">{submitError}</p> : null}
            {lineErrors.length > 0 ? (
              <ul className="errors">
                {lineErrors.map((err) => (
                  <li key={`${err.line}-${err.url}`}>
                    Line {err.line}: {err.url} — {err.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ) : (
        <section aria-label="Batch controls" className="collapsed-panel">
          <span>{processing ? "Processing batch — 'New batch' to start over" : "Batch finished"}</span>
          <button type="button" onClick={requestNewBatch}>
            New batch
          </button>
        </section>
      )}

      {confirmOpen ? (
        <div className="confirm" role="alertdialog" aria-label="Start a new batch?">
          <p>
            Start a new batch? Current results will be cleared and can&apos;t be recovered. Export the
            CSV first if you need them.
          </p>
          <div className="actions">
            <button type="button" onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={confirmNewBatch}>
              Clear and start new batch
            </button>
          </div>
        </div>
      ) : null}

      {/* Region: batch summary bar (hidden until a batch exists) */}
      {batch ? (
        <div className="summary-bar">
          <span>{summaryText}</span>
          {settled ? (
            <a href={`/api/batches/${batch.id}/export.csv`} download="transcripts.csv">
              <button type="button">Export CSV</button>
            </a>
          ) : (
            <button type="button" disabled title="Available when the batch finishes">
              Export CSV
            </button>
          )}
        </div>
      ) : null}

      {/* Region: results list, input order (A-UX1) */}
      {batch ? (
        <ul className="cards">
          {batch.items.map((item, idx) => (
            <ResultCard
              key={item.id}
              item={item}
              index={idx}
              onRetry={(i) => void retry(i)}
              onCopied={() => announce("Transcript copied")}
            />
          ))}
        </ul>
      ) : null}

      {/* Region: live announcements */}
      <div aria-live="polite" className="visually-hidden">
        {announcement}
      </div>
    </main>
  );
}
