import { NextResponse } from 'next/server';
import { getFile, putFile } from '@/lib/repo';
import { authorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Invalid access key' }, { status: 401 });
  }
  const { id, answer } = (await req.json()) as { id?: string; answer?: string };
  if (!id || !answer?.trim()) {
    return NextResponse.json({ error: 'id and answer are required' }, { status: 400 });
  }

  const md = await getFile('product/questions.md');
  if (!md) {
    return NextResponse.json({ error: 'product/questions.md not found' }, { status: 404 });
  }

  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith('### ') && l.includes(id));
  if (start === -1) {
    return NextResponse.json({ error: `Question ${id} not found` }, { status: 404 });
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('### ') || lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const stamped = `**Your answer:** ${answer.trim().replace(/\r?\n/g, ' ')}  \n_(answered via dashboard, ${date})_`;
  const section = lines.slice(start, end);
  const placeholder = section.findIndex((l) => l.includes('**Your answer:**'));
  if (placeholder !== -1) {
    section[placeholder] = stamped;
  } else {
    let insertAt = section.length;
    while (insertAt > 1 && section[insertAt - 1].trim() === '') insertAt--;
    section.splice(insertAt, 0, '', stamped);
  }

  const updated = [...lines.slice(0, start), ...section, ...lines.slice(end)].join('\n');
  try {
    await putFile('product/questions.md', updated, `Answer ${id} via dashboard`);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Write failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
