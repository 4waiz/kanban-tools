import Link from "next/link";
import {
  FileImage,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Link2,
  ArrowRight,
  Zap,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { ConverterCard } from "@/components/converter-card";
import { RecentJobs } from "@/components/recent-jobs";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="relative">
      {/* Subtle command-center grid backdrop behind the hero. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] grid-backdrop" />

      <div className="container relative py-12 sm:py-16">
        {/* ── HERO ── */}
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-primary" />
            All-in-one conversion command center
          </div>
          <h1 className="text-balance text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
            Convert anything. Compress anything.
            <br className="hidden sm:block" />
            <span className="text-primary"> Download what you’re allowed to keep.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
            Drop a file or paste a link. Kanban Tools detects the type, shows what’s
            possible, and hands you a clean, downloadable result — fast, private,
            and auto-cleaned.
          </p>
        </section>

        {/* ── CENTRAL CARD ── */}
        <section className="mx-auto mt-10 max-w-2xl">
          <ConverterCard />
          <FeatureStrip />
        </section>

        {/* ── QUICK TOOLS ── */}
        <section className="mx-auto mt-14 max-w-4xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground">
              Popular tools
            </h2>
            <Link href="/tools">
              <Button variant="ghost" size="sm">
                All tools <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <QuickTool href="/tools?tool=pdf-to-jpg" icon={FileImage} label="PDF → JPG" />
            <QuickTool href="/tools?tool=images-convert" icon={ImageIcon} label="Images" />
            <QuickTool href="/tools?tool=video-to-mp4" icon={Film} label="Video" />
            <QuickTool href="/tools?tool=audio-extract-mp3" icon={Music} label="Audio" />
            <QuickTool href="/tools?tool=zip-extract" icon={Archive} label="ZIP" />
            <QuickTool href="/tools?tool=link-downloader" icon={Link2} label="Links" />
          </div>
        </section>

        {/* ── RECENT JOBS ── */}
        <section className="mx-auto mt-14 max-w-2xl">
          <RecentJobs />
        </section>
      </div>
    </div>
  );
}

function FeatureStrip() {
  const items = [
    { icon: Zap, label: "Fast, local processing" },
    { icon: ShieldCheck, label: "Rights-respecting downloads" },
    { icon: Trash2, label: "Auto-deletes your files" },
  ];
  return (
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {items.map(({ icon: Icon, label }) => (
        <div
          key={label}
          className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-xs text-muted-foreground"
        >
          <Icon className="h-4 w-4 text-primary" />
          {label}
        </div>
      ))}
    </div>
  );
}

function QuickTool({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="edge-tab group flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center transition-colors hover:border-primary/50 hover:bg-secondary/40"
    >
      <Icon className="h-6 w-6 text-muted-foreground transition-colors group-hover:text-primary" />
      <span className="text-xs font-medium">{label}</span>
    </Link>
  );
}
