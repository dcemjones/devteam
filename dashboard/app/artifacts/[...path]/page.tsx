import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFile } from '@/lib/repo';
import Markdown from '@/components/Markdown';

export const dynamic = 'force-dynamic';

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const repoPath = path.map(decodeURIComponent).join('/');

  // Only serve pipeline artifacts, not arbitrary repo files
  if (!repoPath.startsWith('product/') || !repoPath.endsWith('.md') || repoPath.includes('..')) {
    notFound();
  }

  const content = await getFile(repoPath);
  if (content === null) notFound();

  return (
    <>
      <p className="subtitle">
        <Link href="/artifacts">← all artifacts</Link> · <code>{repoPath}</code>
      </p>
      <div className="card">
        <Markdown>{content}</Markdown>
      </div>
    </>
  );
}
