import { Logo } from "@/components/logo";

/**
 * Footer adapted from the bridge-deck footer band: a thin, restrained strip with
 * a workstream label on the left and a classification-style note centered.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border/80">
      <div className="container flex flex-col items-center justify-between gap-3 py-6 sm:flex-row">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Logo showWordmark={false} className="opacity-80" />
          <span>
            Kanban Tools - local file conversion utility. Files auto-delete after
            processing.
          </span>
        </div>
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          DOWNLOAD ONLY WHAT YOU HAVE THE RIGHT TO KEEP
        </p>
      </div>
    </footer>
  );
}
