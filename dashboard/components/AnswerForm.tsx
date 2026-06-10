'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccessKey } from './useAccessKey';

export default function AnswerForm({ id, needsKey }: { id: string; needsKey: boolean }) {
  const [answer, setAnswer] = useState('');
  const [key, setKey] = useAccessKey();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dashboard-key': key },
        body: JSON.stringify({ id, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setStatus({ ok: true, msg: 'Saved — your answer was committed to the repo.' });
      setAnswer('');
      router.refresh();
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="form-row">
        <label htmlFor={`answer-${id}`}>Your answer to {id}</label>
        <textarea
          id={`answer-${id}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer…"
          required
        />
      </div>
      {needsKey && (
        <div className="form-row">
          <label htmlFor={`key-${id}`}>Access key</label>
          <input
            id={`key-${id}`}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Dashboard access key"
          />
        </div>
      )}
      <button type="submit" disabled={busy || !answer.trim()}>
        {busy ? 'Committing…' : 'Submit answer'}
      </button>
      {status && <p className={`form-status ${status.ok ? 'ok' : 'err'}`}>{status.msg}</p>}
    </form>
  );
}
