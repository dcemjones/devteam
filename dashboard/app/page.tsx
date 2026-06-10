import { getFile, repoInfo } from '@/lib/repo';
import { parseStageRows } from '@/lib/parse';
import Markdown from '@/components/Markdown';
import GateForm from '@/components/GateForm';

export const dynamic = 'force-dynamic';

function stepClass(icon: string): string {
  switch (icon) {
    case '✅': return 'step s-done';
    case '🔄': return 'step s-active';
    case '🚧': return 'step s-blocked';
    case '⛔': return 'step s-gate';
    case '❌': return 'step s-killed';
    default: return 'step';
  }
}

export default async function Home() {
  const info = repoInfo();
  const status = await getFile('product/status.md');

  if (!status) {
    return (
      <>
        <h1>Pipeline status</h1>
        <div className="card setup-notice">
          <h2>Can&apos;t read product/status.md</h2>
          <p>
            The dashboard reads pipeline state from <code>{info.repo}</code> (branch{' '}
            <code>{info.branch}</code>) but couldn&apos;t find <code>product/status.md</code>.
          </p>
          <p>Check the Vercel project&apos;s environment variables:</p>
          <ul>
            <li><code>GITHUB_TOKEN</code> — fine-grained PAT with Contents read/write on the repo (required for private repos and for answering/gating)</li>
            <li><code>GITHUB_REPO</code> — defaults to <code>dcemjones/devteam</code></li>
            <li><code>GITHUB_BRANCH</code> — defaults to <code>main</code>; set this if the pipeline lives on another branch</li>
          </ul>
        </div>
      </>
    );
  }

  const rows = parseStageRows(status);
  const done = rows.filter((r) => r.icon === '✅').length;
  const pct = rows.length > 0 ? Math.round((done / rows.length) * 100) : 0;

  return (
    <>
      <h1>Pipeline status</h1>
      <p className="subtitle">Live from {info.repo}@{info.branch} · refresh the page for the latest state</p>

      {rows.length > 0 && (
        <div className="card">
          <h2>Stages</h2>
          <div className="stepper">
            {rows.map((r) => (
              <span key={r.num} className={stepClass(r.icon)} title={r.status}>
                <span className="num">{r.num}</span> {r.icon} {r.stage.replace('⛔', '').trim()}
              </span>
            ))}
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-label">{done} of {rows.length} stages complete ({pct}%)</span>
        </div>
      )}

      <div className="card">
        <Markdown>{status}</Markdown>
      </div>

      <div className="card">
        <h2>Record a gate decision</h2>
        <p className="subtitle">
          Writes a row to <code>product/changelog.md</code> as a commit. The orchestrator picks it up
          as your proceed / revise / kill call at the current gate.
        </p>
        <GateForm needsKey={info.needsKey} />
      </div>
    </>
  );
}
