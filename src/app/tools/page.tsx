import { Suspense } from "react";
import { ToolsGrid } from "@/components/tools-grid";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Tools — Kanban Tools",
  description:
    "Every conversion tool in one place: PDF, images, video, audio, archives, and public links.",
};

export default function ToolsPage() {
  return (
    <div className="container py-12">
      <header className="mb-10 max-w-2xl">
        <p className="eyebrow mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Toolbox
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Pick a tool, get a clean result
        </h1>
        <p className="mt-3 text-muted-foreground">
          Each tool opens the same fast workflow — drop a file (or paste a link),
          tune the options, and download. Tools that need a native dependency are
          marked if it isn’t installed.
        </p>
      </header>

      <Suspense fallback={<ToolsSkeleton />}>
        <ToolsGrid />
      </Suspense>
    </div>
  );
}

function ToolsSkeleton() {
  return (
    <div className="space-y-12">
      {[0, 1].map((s) => (
        <div key={s}>
          <Skeleton className="mb-4 h-6 w-40" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
