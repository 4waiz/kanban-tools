/**
 * Static catalog of tools shown on the /tools page. Each entry deep-links to the
 * home converter with a preset operation. `accept` narrows the file picker.
 *
 * These are presentation metadata only — the real capabilities come from the
 * converter registry. Keep labels aligned with converter output ids.
 */

export type ToolCategory = "PDF" | "Images" | "Video & Audio" | "Archives" | "Links";

export interface ToolDef {
  slug: string;
  title: string;
  description: string;
  category: ToolCategory;
  icon: string; // lucide icon name
  /** Preset output id to select when this tool opens the converter. */
  presetOutputId?: string;
  /** Suggested accept attribute for the file input. */
  accept?: string;
  /** Whether this tool is link-based (URL input) rather than file upload. */
  link?: boolean;
  /** Optional capability key that must be true (from /api/capabilities). */
  requires?: string;
}

export const TOOLS: ToolDef[] = [
  // PDF
  {
    slug: "pdf-to-png",
    title: "PDF to PNG",
    description: "Render every page of a PDF to crisp PNG images.",
    category: "PDF",
    icon: "FileImage",
    presetOutputId: "pdf:png",
    accept: "application/pdf",
    requires: "pdftoppm",
  },
  {
    slug: "pdf-to-jpg",
    title: "PDF to JPG",
    description: "Convert PDF pages to compact JPG images.",
    category: "PDF",
    icon: "FileImage",
    presetOutputId: "pdf:jpg",
    accept: "application/pdf",
    requires: "pdftoppm",
  },
  {
    slug: "pdf-to-svg",
    title: "PDF to SVG",
    description: "Export vector SVG per page where the PDF supports it.",
    category: "PDF",
    icon: "Shapes",
    presetOutputId: "pdf:svg",
    accept: "application/pdf",
    requires: "pdftocairo",
  },
  {
    slug: "pdf-compress",
    title: "PDF compress",
    description: "Shrink PDF size by downsampling embedded images.",
    category: "PDF",
    icon: "Minimize2",
    presetOutputId: "pdf:compress",
    accept: "application/pdf",
    requires: "ghostscript",
  },

  // Images
  {
    slug: "images-convert",
    title: "Images to PNG/JPG/WebP/AVIF",
    description: "Convert between modern image formats in seconds.",
    category: "Images",
    icon: "Image",
    presetOutputId: "image:webp",
    accept: "image/*",
  },
  {
    slug: "resize-image",
    title: "Resize image",
    description: "Resize by width and/or height, aspect ratio preserved.",
    category: "Images",
    icon: "Scaling",
    presetOutputId: "image:resize",
    accept: "image/*",
  },
  {
    slug: "compress-image",
    title: "Compress image",
    description: "Reduce file size at a quality you choose.",
    category: "Images",
    icon: "Minimize2",
    presetOutputId: "image:compress",
    accept: "image/*",
  },
  {
    slug: "upscale-image",
    title: "Upscale image",
    description: "Enlarge 2–4× with high-quality resampling.",
    category: "Images",
    icon: "Maximize2",
    presetOutputId: "image:upscale",
    accept: "image/*",
  },

  // Video & Audio
  {
    slug: "video-to-mp4",
    title: "Video to MP4",
    description: "Re-encode video to widely compatible MP4 (H.264).",
    category: "Video & Audio",
    icon: "Film",
    presetOutputId: "video:mp4",
    accept: "video/*",
    requires: "ffmpeg",
  },
  {
    slug: "video-to-webm",
    title: "Video to WebM",
    description: "Convert to efficient, open WebM (VP9).",
    category: "Video & Audio",
    icon: "Film",
    presetOutputId: "video:webm",
    accept: "video/*",
    requires: "ffmpeg",
  },
  {
    slug: "video-to-gif",
    title: "Video to GIF",
    description: "Turn a clip into a high-quality animated GIF.",
    category: "Video & Audio",
    icon: "Clapperboard",
    presetOutputId: "video:gif",
    accept: "video/*",
    requires: "ffmpeg",
  },
  {
    slug: "audio-extract-mp3",
    title: "Audio extract MP3",
    description: "Pull the audio track from a video as MP3.",
    category: "Video & Audio",
    icon: "Music",
    presetOutputId: "video:mp3",
    accept: "video/*,audio/*",
    requires: "ffmpeg",
  },
  {
    slug: "audio-extract-wav",
    title: "Audio extract WAV",
    description: "Extract lossless WAV audio from media.",
    category: "Video & Audio",
    icon: "AudioLines",
    presetOutputId: "video:wav",
    accept: "video/*,audio/*",
    requires: "ffmpeg",
  },

  // Archives
  {
    slug: "zip-extract",
    title: "ZIP extract",
    description: "Safely unzip an archive with zip-bomb protection.",
    category: "Archives",
    icon: "FolderOpen",
    presetOutputId: "archive:extract",
    accept: ".zip,application/zip",
  },
  {
    slug: "folder-to-zip",
    title: "Folder to ZIP",
    description: "Bundle multiple files or a folder into one ZIP.",
    category: "Archives",
    icon: "FolderArchive",
    presetOutputId: "archive:zip",
  },

  // Links
  {
    slug: "link-downloader",
    title: "Public video link downloader",
    description:
      "Download a direct file, or a public video you’re allowed to keep.",
    category: "Links",
    icon: "Link2",
    link: true,
    requires: "linkDownloader",
  },
  {
    slug: "universal-converter",
    title: "Universal converter",
    description: "Drop anything — we detect the type and show what’s possible.",
    category: "Links",
    icon: "Sparkles",
  },
];

export const TOOL_CATEGORIES: ToolCategory[] = [
  "PDF",
  "Images",
  "Video & Audio",
  "Archives",
  "Links",
];
