import { promises as fs } from 'fs';
import path from 'path';

const REPO = process.env.GITHUB_REPO ?? 'dcemjones/devteam';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const TOKEN = process.env.GITHUB_TOKEN;
const API = 'https://api.github.com';

// On Vercel the repo filesystem isn't available, so reads/writes go through
// the GitHub API. Locally (next dev) we read the working tree directly.
const useGitHub = Boolean(TOKEN || process.env.VERCEL);

function headers(raw = false): Record<string, string> {
  const h: Record<string, string> = {
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

function localPath(repoPath: string) {
  // dashboard/ lives one level below the repo root
  return path.resolve(process.cwd(), '..', repoPath);
}

export async function getFile(repoPath: string): Promise<string | null> {
  if (useGitHub) {
    const res = await fetch(
      `${API}/repos/${REPO}/contents/${repoPath}?ref=${BRANCH}`,
      { headers: headers(true), cache: 'no-store' }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}) for ${repoPath}`);
    return res.text();
  }
  try {
    return await fs.readFile(localPath(repoPath), 'utf8');
  } catch {
    return null;
  }
}

export type Entry = { name: string; path: string; type: 'file' | 'dir' };

export async function listDir(repoPath: string): Promise<Entry[]> {
  if (useGitHub) {
    const res = await fetch(
      `${API}/repos/${REPO}/contents/${repoPath}?ref=${BRANCH}`,
      { headers: headers(), cache: 'no-store' }
    );
    if (!res.ok) return [];
    const items = (await res.json()) as Array<{ name: string; path: string; type: string }>;
    return items.map((i) => ({
      name: i.name,
      path: i.path,
      type: i.type === 'dir' ? 'dir' : 'file',
    }));
  }
  try {
    const items = await fs.readdir(localPath(repoPath), { withFileTypes: true });
    return items.map((d) => ({
      name: d.name,
      path: `${repoPath}/${d.name}`,
      type: d.isDirectory() ? ('dir' as const) : ('file' as const),
    }));
  } catch {
    return [];
  }
}

export async function putFile(repoPath: string, content: string, message: string): Promise<void> {
  if (!useGitHub) {
    await fs.writeFile(localPath(repoPath), content, 'utf8');
    return;
  }
  if (!TOKEN) {
    throw new Error('GITHUB_TOKEN is not configured, so writes are disabled. Add it in Vercel project settings.');
  }
  const meta = await fetch(
    `${API}/repos/${REPO}/contents/${repoPath}?ref=${BRANCH}`,
    { headers: headers(), cache: 'no-store' }
  );
  const sha = meta.ok ? ((await meta.json()) as { sha: string }).sha : undefined;
  const res = await fetch(`${API}/repos/${REPO}/contents/${repoPath}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub write failed (${res.status}): ${await res.text()}`);
  }
}

export function repoInfo() {
  return {
    repo: REPO,
    branch: BRANCH,
    mode: useGitHub ? ('github' as const) : ('local' as const),
    canWrite: !useGitHub || Boolean(TOKEN),
    needsKey: Boolean(process.env.DASHBOARD_PASSWORD),
  };
}
