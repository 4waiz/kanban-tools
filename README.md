# Kanban Tools

**Convert anything. Compress anything. Right in your browser.**

Kanban Tools is a minimal, **100% client-side** file-conversion utility. Drop a
file and it detects the type, shows the possible outputs, converts it **in your
browser**, and hands you the result to download. Your files are **never
uploaded** - there is no server, no storage, nothing leaves your device.

The UI uses a precise, futuristic "command-center" aesthetic - flat slate + a
single orange accent, generous spacing, light/dark mode - adapted from the
*bridge-deck* design system.

---

## How it works

Everything runs in the browser using WebAssembly and native browser APIs:

| Engine | Used for |
| --- | --- |
| **Canvas / `createImageBitmap`** | Image convert (PNG/JPG/WebP/AVIF), resize, compress, upscale |
| **pdf.js** | PDF → PNG / JPG pages |
| **ffmpeg.wasm** | Video → MP4 / WebM / GIF, audio extract MP3 / WAV, compress |
| **fflate** | ZIP extract (with zip-bomb guards) and bundle files → ZIP |

Because the work is local, the app is just **static files** - it hosts on
Cloudflare Pages (or any static host) with no backend.

### What needs a server (shown but disabled)

Three operations can't run in a browser and are surfaced **greyed-out** with an
explanation, so the full toolset is still visible:

- **PDF → SVG** and **PDF compress** - need native tools (Poppler / Ghostscript).
- **Public link / video downloader** - blocked by CORS and needs yt-dlp.

> **Note on performance:** browser conversion is **CPU via WebAssembly, not GPU**.
> Video is slower than a native tool and is bounded by the tab's memory, so very
> large videos may fail. Images, PDFs, and archives are fast.

---

## Run locally

Requires **Node.js 20+**.

```bash
npm install
npm run dev      # http://localhost:3000
```

Build the static site:

```bash
npm run build    # outputs to ./out
```

Other scripts:

```bash
npm run lint
npm run typecheck
npm test         # detection + filename-safety unit tests
```

### Local note about video/audio

ffmpeg.wasm needs the page to be **cross-origin isolated** (COOP + COEP headers).
`next dev` doesn't send those, so **video/audio conversion is disabled in
`npm run dev`** but works on the deployed site (and in `npm run build` previews
served with the headers). Images / PDF / ZIP work everywhere. The headers live
in [`public/_headers`](public/_headers) and are applied by Cloudflare Pages.

---

## Deploy to Cloudflare Pages (with a custom domain)

This deploys as a static site - no container, no server.

### Option A - Git integration (recommended)

1. Push this repo to GitHub (already at `github.com/4waiz/kanban-tools`).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repo, then set:
   - **Framework preset:** Next.js (Static HTML Export) - or "None"
   - **Build command:** `npm run build`
   - **Build output directory:** `out`
4. Deploy. You get `https://kanban-tools.pages.dev`.

### Option B - Direct upload

```bash
npm run build
npx wrangler pages deploy out --project-name kanban-tools
```

### Custom domain (app.kanbanstudios.ae)

Because the domain is already on Cloudflare, this is one step:

1. Pages project → **Custom domains → Set up a custom domain**.
2. Enter **`app.kanbanstudios.ae`**. Cloudflare adds the DNS record and issues
   the certificate automatically (same account, so no manual CNAME needed).
3. Done - `https://app.kanbanstudios.ae` serves the app.

> The `_headers` file ships the COOP/COEP isolation headers, so ffmpeg.wasm
> (video/audio) works on the deployed site.

---

## Project structure

```
src/
  app/
    page.tsx              Home: hero + central converter card + recent list
    tools/page.tsx        Tools catalog (opens the converter with a preset)
    settings/page.tsx     Theme, defaults, and browser capability report
  components/             UI (shadcn primitives + app components)
    converter-card.tsx    The drop → detect → convert → download workflow
  lib/
    engine.ts             Client-side orchestration: detect, run, bundle, save
    detect.ts             Magic-byte + MIME + extension detection
    capabilities.ts       What THIS browser can do (isolation, AVIF/WebP encode)
    security.ts           Filename sanitization (browser-safe)
    types.ts              Shared types + the Converter contract
    converters/
      registry.ts         Wires converters together
      image.ts  pdf.ts  video.ts  archive.ts  link.ts
public/
  _headers               COOP/COEP + security headers for Cloudflare Pages
```

### The converter contract

```ts
interface Converter {
  id: ConverterId;
  detect(input: DetectInput): boolean;
  getAvailableOutputs(input: DetectInput): OutputOption[];
  convert(ctx: ConvertContext): Promise<ConvertResult>; // returns Blob artifacts
}
```

Add a converter by implementing this in `src/lib/converters/<name>.ts` and
registering it in `registry.ts`. Output ids are namespaced (`image:webp`,
`pdf:jpg`, `video:mp3`, …) so routing is automatic. An option can set
`unavailableReason` to render disabled (used for the native-only operations).

---

## Privacy

There is no backend. Files are read into memory, converted in a Web Worker / the
main thread, and offered as a download. Nothing is transmitted anywhere; the
"recent conversions" list stores only names and timestamps in `localStorage`.

---

## License

Provided as-is for you to build on. No EDGE Group logos, trademarks, or assets
are used; the wordmark and glyph are original.
