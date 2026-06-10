/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output so the Docker image can run `node server.js` without dev deps.
  output: "standalone",
  // This app is intentionally isolated from the repo-root dashboard (ADR-003): its own
  // lockfile is authoritative, so pin file tracing to this directory.
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [
      {
        // NFR-4 / threat #3: never let search engines index this tool.
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
