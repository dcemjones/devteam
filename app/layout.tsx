import type { Metadata } from 'next';
import Link from 'next/link';
import { repoInfo } from '@/lib/repo';
import './globals.css';

export const metadata: Metadata = {
  title: 'DevTeam Pipeline',
  description: 'Product build pipeline dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const info = repoInfo();
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand">⚙ DevTeam Pipeline</Link>
            <nav>
              <Link href="/">Status</Link>
              <Link href="/artifacts">Artifacts</Link>
              <Link href="/questions">Questions</Link>
            </nav>
            <span className="repo-badge" title={`Reading from ${info.mode === 'github' ? 'GitHub API' : 'local files'}`}>
              {info.repo}@{info.branch}
            </span>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
