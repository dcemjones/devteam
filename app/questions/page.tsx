import { getFile, repoInfo } from '@/lib/repo';
import { parseOpenQuestions } from '@/lib/parse';
import Markdown from '@/components/Markdown';
import AnswerForm from '@/components/AnswerForm';

export const dynamic = 'force-dynamic';

export default async function QuestionsPage() {
  const info = repoInfo();
  const md = await getFile('product/questions.md');

  if (!md) {
    return (
      <>
        <h1>Open questions</h1>
        <p className="empty-note">product/questions.md not found — check the repo configuration on the Status page.</p>
      </>
    );
  }

  const open = parseOpenQuestions(md);

  return (
    <>
      <h1>Open questions</h1>
      <p className="subtitle">
        Agents log questions here when they need your input. Answers are committed straight back to{' '}
        the repo, and the orchestrator reads them before each stage.
      </p>

      {open.length === 0 && (
        <div className="card">
          <p className="empty-note">No open questions — the pipeline isn&apos;t waiting on you.</p>
        </div>
      )}

      {open.map((q) => (
        <div key={q.id} className="card question-card">
          <h3>{q.heading}</h3>
          <Markdown>{q.body}</Markdown>
          <AnswerForm id={q.id} needsKey={info.needsKey} />
        </div>
      ))}

      <details>
        <summary>View full questions.md (including resolved)</summary>
        <div className="card">
          <Markdown>{md}</Markdown>
        </div>
      </details>
    </>
  );
}
