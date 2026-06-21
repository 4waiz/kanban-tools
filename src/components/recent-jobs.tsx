"use client";

import * as React from "react";
import Link from "next/link";
import {
  Clock,
  Trash2,
  Image as ImageIcon,
  FileText,
  Film,
  Music,
  Archive,
  Link2,
  File as FileIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { timeAgo } from "@/lib/utils";
import {
  getRecentJobs,
  removeRecentJob,
  clearRecentJobs,
  type RecentJob,
} from "@/lib/local-store";
import { deleteJobRequest } from "@/lib/client";
import type { InputKind } from "@/lib/types";

const KIND_ICON: Record<InputKind, React.ElementType> = {
  image: ImageIcon,
  pdf: FileText,
  video: Film,
  audio: Music,
  archive: Archive,
  link: Link2,
  unknown: FileIcon,
};

export function RecentJobs() {
  const [jobs, setJobs] = React.useState<RecentJob[]>([]);
  const [mounted, setMounted] = React.useState(false);

  const refresh = React.useCallback(() => setJobs(getRecentJobs()), []);

  React.useEffect(() => {
    setMounted(true);
    refresh();
    const onChange = () => refresh();
    window.addEventListener("kanban-tools:store", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("kanban-tools:store", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [refresh]);

  async function handleDelete(job: RecentJob) {
    // Try to delete server-side files too; ignore failures (may already be gone).
    try {
      await deleteJobRequest(job.id, job.token);
    } catch {
      /* ignore */
    }
    removeRecentJob(job.id);
    refresh();
  }

  if (!mounted) return null;

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Clock className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium">No recent jobs yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your conversions will show up here. They’re stored locally in your
          browser.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Recent jobs
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearRecentJobs();
            refresh();
          }}
        >
          Clear all
        </Button>
      </div>
      <ul className="space-y-2">
        {jobs.map((job) => {
          const Icon = KIND_ICON[job.kind] ?? FileIcon;
          return (
            <li
              key={job.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <Icon className="h-4 w-4" />
              </div>
              <Link
                href={`/jobs/${job.id}?token=${encodeURIComponent(job.token)}`}
                className="min-w-0 flex-1"
              >
                <p className="truncate text-sm font-medium">{job.label}</p>
                <p className="text-xs text-muted-foreground">
                  {job.outputLabel ? `${job.outputLabel} · ` : ""}
                  {timeAgo(job.createdAt)}
                </p>
              </Link>
              <StatusPill status={job.status} className="hidden sm:inline-flex" />
              <button
                onClick={() => handleDelete(job)}
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                aria-label="Delete job"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
