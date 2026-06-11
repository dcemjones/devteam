# Influencer Transcript Translator — single always-on container (arch §13, ADR-003).
# node:22-slim + ffmpeg (apt) + yt-dlp (standalone binary, pinnable) + Next.js standalone output.
#
# NOT VERIFIED IN THE BUILD SANDBOX: no Docker daemon was available (build log, T-404).
# First `docker build` + boot is part of launch-blocking checklist item LB-02 (see README).
#
# yt-dlp REBUILD PATH (the dominant maintenance task, arch §12): when `extractor_error`
# spikes in the logs, rebuild this image — by default it pulls the latest yt-dlp release.
# To pin (recommended once LB-01 verifies a working version):
#   docker build --build-arg YTDLP_VERSION=2025.12.30 -t itt .

# ---- build stage -----------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
FROM node:22-slim AS runner

# ffmpeg for the EXTRACT safety net; curl+certs only to fetch yt-dlp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp: the *_linux asset is the self-contained binary (no Python needed in the image).
ARG YTDLP_VERSION=""
RUN if [ -n "$YTDLP_VERSION" ]; then \
      url="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux"; \
    else \
      url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"; \
    fi \
  && curl -fL "$url" -o /usr/local/bin/yt-dlp \
  && chmod 0755 /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    ITT_TMP_DIR=/tmp/itt

# Standalone output: server.js + minimal node_modules, plus the static assets.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Least privilege: no root, no secrets baked in — OPENAI_API_KEY arrives via the host's
# secret store at run time and is required at boot unless MOCK_PROVIDERS=1.
USER node

EXPOSE 3100
# /api/health checks tmp writable + key present + yt-dlp --version.
HEALTHCHECK --interval=60s --timeout=10s --start-period=15s \
  CMD curl -sf http://127.0.0.1:3100/api/health || exit 1

CMD ["node", "server.js"]
