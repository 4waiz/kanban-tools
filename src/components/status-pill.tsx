import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/lib/types";

/**
 * Flat status pill matching the bridge-deck "chip" motif. No gradients; slate by
 * default, orange/green/red only where it carries meaning.
 */
export function StatusPill({
  status,
  className,
}: {
  status: JobStatus;
  className?: string;
}) {
  const map: Record<
    JobStatus,
    { label: string; icon: React.ReactNode; cls: string }
  > = {
    pending: {
      label: "Pending",
      icon: <Clock className="h-3.5 w-3.5" />,
      cls: "bg-secondary text-secondary-foreground",
    },
    processing: {
      label: "Processing",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      cls: "bg-primary/10 text-primary",
    },
    completed: {
      label: "Completed",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    failed: {
      label: "Failed",
      icon: <XCircle className="h-3.5 w-3.5" />,
      cls: "bg-destructive/10 text-destructive",
    },
  };
  const s = map[status];
  return (
    <span className={cn("pill", s.cls, className)}>
      {s.icon}
      {s.label}
    </span>
  );
}
