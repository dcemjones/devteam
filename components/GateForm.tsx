'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccessKey } from './useAccessKey';

export default function GateForm({ needsKey }: { needsKey: boolean }) {
  const [stage, setStage] = useState('');
  const [decision, setDecision] = useState('proceed');
  const [rationale, setRationale] = useState('');
  const [key, setKey] = useAccessKey();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-dashboard-key': key },
        body: JSON.stringify({ stage, decision, rationale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setStatus({ ok: true, msg: 'Recorded — your decision was committed to the changelog.' });
      setStage('');
      setRationale('');
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
        <label htmlFor="gate-stage">Gate / stage</label>
        <input
          id="gate-stage"
          type="text"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          placeholder="e.g. 1 Discovery"
          required
        />
      </div>
      <div className="form-row">
        <label htmlFor="gate-decision">Decision</label>
        <select id="gate-decision" value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="proceed">Proceed</option>
          <option value="revise">Revise</option>
          <option value="kill">Kill</option>
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="gate-rationale">Rationale (optional)</label>
        <textarea
          id="gate-rationale"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Why?"
        />
      </div>
      {needsKey && (
        <div className="form-row">
          <label htmlFor="gate-key">Access key</label>
          <input
            id="gate-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Dashboard access key"
          />
        </div>
      )}
      <button type="submit" disabled={busy || !stage.trim()}>
        {busy ? 'Committing…' : 'Record decision'}
      </button>
      {status && <p className={`form-status ${status.ok ? 'ok' : 'err'}`}>{status.msg}</p>}
    </form>
  );
}
