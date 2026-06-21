# Kanban Tools

**Convert anything. Compress anything. Download what you’re allowed to keep.**

Kanban Tools is an all-in-one, minimal file-conversion and download utility. Drop
a file (or paste a link), and the app detects the type, shows the possible
outputs, converts/compresses/resizes/extracts, and hands you a clean,
downloadable result. Files are processed in isolated per-job folders and
auto-deleted after a short window.

The UI follows a precise, futuristic “command-center” aesthetic - flat slate +
a single orange accent, generous spacing, light/dark mode - adapted from the
*bridge-deck* design system.

> **Production-ready, single-node.** Conversions run through a **bounded worker
> pool** (no resource exhaustion under load), job state is **crash-recoverable**
> on disk with **atomic writes**, the process does a **graceful shutdown** so a
> deploy doesn’t kill in-flight jobs, and there are **liveness/readiness**
> probes, **structured JSON logs**, **security headers**, **disk + concurrency
> quotas**, and **DNS-resolving SSRF protection**. Scaling to multiple instances
> additionally needs a shared store/queue (Redis/BullMQ) - see **Scaling out**.

---

## Features

- **Universal input** - drag & drop files/folders, multi-file upload, or paste a URL.
- **Auto-detection** - input type is detected from magic bytes + MIME + extension.
- **Dynamic outputs** - the format dropdown changes based on what you dropped.
- **Plugin converter system** - `image`, `pdf`, `video`, `archive`, `link`.
- **Job lifecycle** - `pending → processing → completed / failed`, with live progress.
- **Auto-bundling** - multiple outputs are zipped into one download automatically.
- **Safety first** - sanitized filenames, path-traversal protection, zip-bomb
  guards, SSRF checks, rate limiting, and auto-cleanup.
- **Rights-respecting downloads** - the link tool never bypasses DRM, paywalls,
  logins, or private content, and requires an explicit confirmation.

### Supported conversions (MVP)

| Category | Operations |
| --- | --- |
| **PDF** | PDF → PNG pages · PDF → JPG pages · PDF → SVG pages · Compress PDF |
| **Images** | PNG/JPG/WebP/AVIF inter-convert · Resize (W/H) · Compress (quality) · Upscale 2–4× |
| **Video** | Video → MP4 · Video → WebM · Video → GIF · Compress preset |
| **Audio** | Extract MP3 · Extract WAV |
| **Archives** | Safe ZIP extract · Multiple files/folder → ZIP |
| **Links** | Direct file URL download · Public media pages via yt-dlp (where legal) |

---

## Tech stack

- **Next.js (App Router)** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** primitives (hand-rolled, in `src/components/ui`)
- **Node.js** route handlers (no external API needed)
- **Sharp** - image conversion/compression/resize/upscale (no system lib needed)
- **FFmpeg** - video/audio
- **Poppler** (`pdftoppm`, `pdftocairo`, `pdfinfo`) - PDF → image/SVG
- **Ghostscript** - PDF compression
- **yauzl** (safe streaming unzip) + **archiver** (zip creation)
- **yt-dlp** - public, legal media-page downloads
- **Docker** + **docker-compose**

---

## Quick start (Docker - recommended)

Docker is the easiest path because the image bundles every native tool.

```bash
# from the project root
docker compose up --build
# open http://localhost:3000
```

That’s it. FFmpeg, Poppler, Ghostscript, and yt-dlp are installed inside the
image; job files live on a named volume and auto-delete by TTL.

---

## Local development

### 1. Install Node dependencies

Requires **Node.js 20+**.

```bash
npm install
```

### 2. Install the native tools

Sharp is bundled via npm (prebuilt binaries) - no action needed. The rest are
system tools. Install the ones you need; missing tools simply disable their
features (the Tools page marks them **Unavailable**, and `/api/capabilities`
reports status).

<details>
<summary><strong>macOS (Homebrew)</strong></summary>

```bash
brew install ffmpeg poppler ghostscript yt-dlp
```
</details>

<details>
<summary><strong>Debian / Ubuntu</strong></summary>

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg poppler-utils ghostscript
# yt-dlp (pick one):
sudo apt-get install -y yt-dlp            # if packaged
# or:
python3 -m pip install --user yt-dlp
```
</details>

<details>
<summary><strong>Windows</strong></summary>

Using <a href="https://github.com/microsoft/winget-cli">winget</a>:

```powershell
winget install Gyan.FFmpeg
winget install oschwartz10612.Poppler   # or download poppler-windows
winget install ArtifexSoftware.GhostScript
winget install yt-dlp.yt-dlp
```

If a tool isn’t on your `PATH`, set the explicit path in `.env.local`
(e.g. `PDFTOPPM_PATH`, `GHOSTSCRIPT_PATH=gswin64c`, `FFMPEG_PATH`). See
`.env.example`.
</details>

### 3. Configure environment (optional)

```bash
cp .env.example .env.local
# edit values as needed
```

### 4. Run

```bash
npm run dev
# open http://localhost:3000
```

Other scripts:

```bash
npm run build       # production build
npm start           # run the production build
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm test            # vitest (converter detection + path-safety tests)
```

---

## Configuration

All configuration is via environment variables (see `.env.example` for the full,
commented list). Highlights:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONVERT_JOBS_DIR` | OS temp + `/convert-jobs` | Where per-job folders live |
| `MAX_FILE_SIZE_MB` | `512` | Max upload size |
| `JOB_TTL_MINUTES` | `30` | How long results are kept before deletion |
| `CLEANUP_INTERVAL_MINUTES` | `5` | Background cleanup cadence |
| `ZIP_MAX_TOTAL_BYTES` / `ZIP_MAX_ENTRIES` / `ZIP_MAX_COMPRESSION_RATIO` | 1 GB / 10000 / 120 | Zip-bomb guards |
| `RATE_LIMIT_*` | 40 / 60s | In-memory rate limit |
| `ENABLE_LINK_DOWNLOADER` | `true` | Master switch for the link tool |
| `YTDLP_PATH`, `FFMPEG_PATH`, `PDFTOPPM_PATH`, … | tool name on PATH | Binary overrides |

---

## Architecture

```
src/
  instrumentation.ts         Runs once at server boot → lifecycle.startup()
  app/
    page.tsx                 Home: hero + central converter card + recent jobs
    tools/page.tsx           Tools catalog (opens the converter with a preset)
    jobs/[id]/page.tsx       Job result page (status, info, download, delete)
    settings/page.tsx        Preferences + environment capabilities
    api/
      detect/route.ts        Detect input type + available outputs
      upload/route.ts        Multipart upload → creates a job (atomic writes)
      convert/route.ts       Enqueue a conversion on the worker pool
      link/route.ts          Start a link download (requires rights confirmation)
      jobs/[id]/route.ts     GET status · DELETE files (token-gated)
      jobs/[id]/download/    Stream the result (token-gated, safe path)
      capabilities/route.ts  Which native tools are installed + queue stats
      health/route.ts        Liveness probe
      ready/route.ts         Readiness probe (disk writable + headroom)
  components/                UI (shadcn primitives + app components)
  lib/
    config.ts                Env-driven configuration (incl. worker/limits)
    types.ts                 Shared domain types + the Converter contract
    detect.ts                Magic-byte + MIME + extension detection
    security.ts              Filename sanitize, safeJoin, URL + IP validation
    ssrf.ts                  DNS-resolving SSRF guard for the link downloader
    exec.ts                  spawn(arg[]) wrapper with timeouts (no shell)
    fs-utils.ts              Atomic writes (temp+rename), dir size, disk guard
    jobs.ts                  Job store (disk-backed, atomic, crash-recoverable)
    queue.ts                 Bounded work queue + fixed-size worker pool
    runner.ts                Executes a converter via the queue; bundles outputs
    lifecycle.ts             Startup (recovery + cleanup) + graceful shutdown
    cleanup.ts               Thin shim → lifecycle.startup()
    rate-limit.ts            In-memory token bucket + hashed client key
    logger.ts                Structured JSON logger (dev-friendly in dev)
    api.ts                   Route guard: rate limit, capacity, request id, log
    converters/
      registry.ts            Wires converters together
      image.ts  pdf.ts  video.ts  archive.ts  link.ts
```

### Reliability & operations

- **Bounded worker pool** (`queue.ts` + `runner.ts`): at most `WORKER_CONCURRENCY`
  conversions run at once, with a bounded backlog. A burst of uploads can’t spawn
  unbounded FFmpeg/Sharp processes; excess work queues, and a full backlog returns
  HTTP 503 (fail fast) rather than melting the box.
- **Crash recovery**: on boot, jobs left in `processing` by a killed process are
  marked `failed` (not stuck forever). Job state lives in `metadata.json`.
- **Atomic writes**: metadata and uploaded files are written to a temp file then
  renamed, so a crash mid-write never leaves a corrupt/empty file.
- **Graceful shutdown**: on `SIGTERM`/`SIGINT` the queue stops accepting work and
  drains in-flight jobs within `WORKER_SHUTDOWN_GRACE_SECONDS` before exit
  (compose sets a matching `stop_grace_period`).
- **Probes**: `GET /api/health` (liveness) and `GET /api/ready` (readiness -
  verifies the jobs dir is writable and disk has headroom; 503 when not).
- **Observability**: structured single-line JSON logs in production with a
  per-request `X-Request-Id` propagated to responses; queue depth on
  `/api/capabilities` and `/api/ready`.
- **Capacity guards**: global disk quota (`MAX_TOTAL_DISK_BYTES`), per-client
  concurrent-job cap (`MAX_JOBS_PER_CLIENT`), per-request rate limit, and upload
  size/count caps.

### The converter plugin contract

Every converter implements:

```ts
interface Converter {
  id: ConverterId;
  detect(input: DetectInput): boolean;
  getAvailableOutputs(input: DetectInput): OutputOption[];
  convert(ctx: ConvertContext): Promise<ConvertResult>;
}
```

**Adding a new converter** is: implement the contract in
`src/lib/converters/<name>.ts`, then add it to the `converters` array in
`registry.ts`. Output option ids are namespaced by converter
(`image:webp`, `pdf:jpg`, `video:mp3`, …) so routing is automatic.

### Job model

- Each job is a directory: `<CONVERT_JOBS_DIR>/<jobId>/` with `input/`,
  `output/`, and `metadata.json`.
- A per-job **token** is required to read, download, or delete a job - knowing a
  job id alone is not enough.
- The cleanup worker deletes jobs older than `JOB_TTL_MINUTES`, scanning both
  memory and disk (so leftovers from a previous process are reclaimed).

---

## Security model

The trust boundary lives in `src/lib/security.ts` and `src/lib/exec.ts`:

- **No shell injection** - external tools are run with `spawn(bin, args[])` and
  `shell: false`; user values are never interpolated into a command string.
- **Filename sanitization** - uploads and archive entries are reduced to a safe
  charset; directory components are stripped.
- **Path-traversal protection** - every user-derived path goes through
  `safeJoin`, which asserts the resolved path stays inside its job directory.
- **Zip-bomb defense** - extraction meters real (not header-claimed) bytes, caps
  total size + entry count, and aborts on a suspicious compression ratio. Symlink
  entries are skipped. (`src/lib/converters/archive.ts`)
- **SSRF reduction** - the link tool only allows http/https and rejects
  localhost / private / link-local / cloud-metadata hosts.
- **Rate limiting** - a per-IP token bucket on every route.
- **Per-job tokens** - gate download/delete/status.
- **Auto-deletion** - temp files don’t linger.

### Legal posture for the link downloader

The link downloader is intentionally conservative:

- It requires the user to check **“I confirm I have the right to download this
  content.”** before anything runs.
- It supports **direct file URLs** and a small allowlist of **public** media
  platforms via yt-dlp.
- It **does not** bypass DRM, paywalls, logins, private accounts, or any access
  control, and passes no credentials/cookies. Protected/unsupported links return
  a polite error.

You are responsible for using it only with content you own or have permission to
download.

---

## Scaling out (multi-instance)

The app is production-ready on a **single node**. The job store, queue, and
rate-limiter are in-process by design - correct and efficient for one instance.
To run **multiple instances behind a load balancer**, swap these for shared
infrastructure (the interfaces are small and isolated):

- **Job store** → Redis/Postgres instead of the in-memory index in `jobs.ts`
  (the disk-backed `metadata.json` already provides durability for one node).
- **Queue** → BullMQ/SQS + a dedicated worker process instead of the in-process
  `WorkQueue`, so jobs survive a web-tier restart and spread across workers.
- **File storage** → S3/R2/GCS with presigned upload/download URLs so the web
  tier never proxies large files (a `STORAGE_PROVIDER` placeholder exists in
  `.env.example` and Settings). On a single node, local disk + TTL cleanup is
  the right, simple choice.
- **Rate limiting** → Redis-backed (INCR + EXPIRE), keyed by user where you add
  auth.

Each of the above is a contained change; the converter contract, routes, and UI
stay the same. The remaining hardening note is infra-level, not code:

- **SSRF (defense in depth)**: the link downloader already resolves DNS and
  blocks private/reserved IPs (v4+v6). For a hostile multi-tenant deployment,
  additionally route egress through an allowlisting proxy and/or pin connections
  to the validated IP to fully close the TOCTOU/DNS-rebind window.

---

## Acceptance checklist

- [x] Run locally with Docker Compose
- [x] Upload a PDF → convert pages to JPG/PNG/SVG, or compress
- [x] Upload an image → convert / compress / resize / upscale
- [x] Upload a video → extract MP3/WAV, or convert MP4/WebM/GIF
- [x] Upload multiple files → download results as a ZIP
- [x] Extract a ZIP safely (with zip-bomb protection)
- [x] Paste a direct file URL → download it
- [x] Paste a supported public video link (only with rights confirmation)
- [x] Polished, minimal, responsive UI with dark/light mode
- [x] Doesn’t crash on unsupported files (clear error states)

---

## License

Provided as-is for you to build on. No EDGE Group logos, trademarks, or assets
are used; the wordmark and glyph are original.
