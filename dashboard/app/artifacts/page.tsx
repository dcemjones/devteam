import Link from 'next/link';
import { listDir, type Entry } from '@/lib/repo';

export const dynamic = 'force-dynamic';

type Group = { dir: string; files: Entry[] };

export default async function ArtifactsPage() {
  const root = await listDir('product');
  const rootFiles = root.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
  const dirs = root.filter((e) => e.type === 'dir');

  const groups: Group[] = await Promise.all(
    dirs.map(async (d) => ({
      dir: d.name,
      files: (await listDir(d.path)).filter((e) => e.type === 'file' && e.name.endsWith('.md')),
    }))
  );

  const total = rootFiles.length + groups.reduce((n, g) => n + g.files.length, 0);

  return (
    <>
      <h1>Artifacts</h1>
      <p className="subtitle">Everything the pipeline has produced under /product, freshest state from the repo.</p>

      <div className="card">
        {total === 0 && <p className="empty-note">No artifacts yet — kick off a build and they&apos;ll appear here stage by stage.</p>}
        <ul className="file-tree">
          {rootFiles.map((f) => (
            <li key={f.path}>
              <Link href={`/artifacts/${f.path}`}>{f.name}</Link>
            </li>
          ))}
          {groups.map((g) => (
            <li key={g.dir}>
              <div className="dir-name">{g.dir}</div>
              {g.files.length === 0 ? (
                <p className="empty-note">empty</p>
              ) : (
                <ul className="file-tree">
                  {g.files.map((f) => (
                    <li key={f.path}>
                      <Link href={`/artifacts/${f.path}`}>{f.name}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
