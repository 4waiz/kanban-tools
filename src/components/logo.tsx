import { cn } from "@/lib/utils";

/**
 * Kanban Tools wordmark.
 *
 * Original mark - deliberately NOT any EDGE Group logo or trademark. It mirrors
 * the bridge-deck identity (flat slate + a single orange accent block) without
 * borrowing protected assets. The square "command-center" glyph uses the brand
 * orange; the wordmark uses currentColor so it inverts cleanly in dark mode.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoGlyph className="h-7 w-7" />
      {showWordmark && (
        <span className="text-[15px] font-bold leading-none tracking-tight">
          Kanban<span className="text-primary"> Tools</span>
        </span>
      )}
    </span>
  );
}

/** The standalone glyph: a precise, futuristic "convert" mark. */
export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* slate rounded frame */}
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="7"
        className="fill-ink dark:fill-ink-2"
      />
      {/* three "lanes" - a nod to a kanban board, in white */}
      <rect x="7" y="8" width="4.2" height="16" rx="1.4" fill="#ffffff" opacity="0.92" />
      <rect x="14" y="8" width="4.2" height="11" rx="1.4" fill="#ffffff" opacity="0.7" />
      {/* the active lane / accent - brand orange */}
      <rect x="21" y="8" width="4.2" height="16" rx="1.4" className="fill-brand" />
    </svg>
  );
}
