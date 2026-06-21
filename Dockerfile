# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Kanban Tools - multi-stage Dockerfile
#
# Produces a small runtime image that includes the native tools the converters
# rely on: FFmpeg (video/audio), Poppler (PDF→image/SVG), Ghostscript (PDF
# compress), and yt-dlp (public link downloads). Sharp ships as an npm dep with
# prebuilt binaries, so no system image library is required for it on Debian.
# ─────────────────────────────────────────────────────────────────────────────

# ---- 1. Dependencies ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# libvips speeds up Sharp if present; prebuilt binaries are used otherwise.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# ---- 2. Build ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 3. Runtime ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CONVERT_JOBS_DIR=/data/convert-jobs

# Install native conversion tools.
#  - ffmpeg          : video/audio
#  - poppler-utils   : pdftoppm, pdftocairo, pdfinfo (PDF -> image/SVG)
#  - ghostscript     : PDF compression
#  - ca-certificates : TLS for link downloads
#  - python3 + yt-dlp: public media-page downloads (optional but supported)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        poppler-utils \
        ghostscript \
        ca-certificates \
        python3 \
        python3-pip \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user and a writable data dir for job files.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && mkdir -p /data/convert-jobs \
    && chown -R nextjs:nodejs /data

# Copy the standalone server output.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# next standalone emits server.js at the project root.
CMD ["node", "server.js"]
