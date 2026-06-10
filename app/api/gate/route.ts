import { NextResponse } from 'next/server';
import { getFile, putFile } from '@/lib/repo';
import { authorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const DECISIONS = ['proceed', 'revise', 'kill'] as const;

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Invalid access key' }, { status: 401 });
  }
  const { stage, decision, rationale } = (await req.json()) as {
    stage?: string;
    decision?: string;
    rationale?: string;
  };
  if (!stage?.trim() || !DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
    return NextResponse.json(
      { error: 'stage and a decision of proceed/revise/kill are required' },
      { status: 400 }
    );
  }

  const md = await getFile('product/changelog.md');
  if (!md) {
    return NextResponse.json({ error: 'product/changelog.md not found' }, { status: 404 });
  }

  const lines = md.split('\n');
  const sep = lines.findIndex((l) => /^\|\s*-+/.test(l));
  if (sep === -1) {
    return NextResponse.json({ error: 'Decision table not found in changelog.md' }, { status: 500 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const row = `| ${date} | ${cell(stage)} | ${decision!.toUpperCase()} | user (dashboard) | ${cell(rationale || '—')} |`;
  lines.splice(sep + 1, 0, row);

  try {
    await putFile(
      'product/changelog.md',
      lines.join('\n'),
      `Gate decision: ${stage.trim()} → ${decision} (via dashboard)`
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Write failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
