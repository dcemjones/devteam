export type StageRow = {
  num: string;
  stage: string;
  agent: string;
  status: string;
  icon: string;
};

const ICONS = ['✅', '🔄', '🚧', '⛔', '❌', '⬜'];

/** Pull stage rows out of the status.md tracker table. Tolerant: returns [] if the table isn't there. */
export function parseStageRows(statusMd: string): StageRow[] {
  const rows: StageRow[] = [];
  for (const line of statusMd.split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|([^|]+)\|([^|]+)\|([^|]+)\|/);
    if (!m) continue;
    const status = m[4].trim();
    const icon = ICONS.find((i) => status.includes(i)) ?? '⬜';
    rows.push({ num: m[1], stage: m[2].trim(), agent: m[3].trim(), status, icon });
  }
  return rows;
}

export type OpenQuestion = { id: string; heading: string; body: string };

/** Parse `### Q-...` sections from the Open half of questions.md, ignoring HTML-comment templates. */
export function parseOpenQuestions(md: string): OpenQuestion[] {
  const noComments = md.replace(/<!--[\s\S]*?-->/g, '');
  const open = noComments.split(/^## Resolved\b/m)[0];
  const chunks = open.split(/^### /m).slice(1);
  return chunks
    .map((chunk) => {
      const newline = chunk.indexOf('\n');
      const headingLine = newline === -1 ? chunk : chunk.slice(0, newline);
      const body = newline === -1 ? '' : chunk.slice(newline + 1);
      const id = headingLine.match(/Q-[A-Za-z0-9_-]+/)?.[0];
      return id ? { id, heading: headingLine.trim(), body: body.trim() } : null;
    })
    .filter((q): q is OpenQuestion => q !== null);
}
