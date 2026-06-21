"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Download,
  Trash2,
  ArrowLeft,
  FileInput,
  FileOutput,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { StatusPill } from "@/components/status-pill";
import { useToast } from "@/components/ui/toast";
import { formatBytes, timeAgo } from "@/lib/utils";
import {
  fetchJob,
  pollJob,
  deleteJobRequest,
  downloadUrl,
  type PublicJob,
} from "@/lib/client";
import { removeRecentJob, updateRecentJob } from "@/lib/local-store";

export function JobDetail({ jobId, token }: { jobId: string; token: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [job, setJob] = React.useState<PublicJob | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (!token) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let abort = new AbortController();
    (async () => {
      try {
        const initial = await fetchJob(jobId, token);
        setJob(initial);
        setLoading(false);
        if (initial.status === "pending" || initial.status === "processing") {
          await pollJob(
            jobId,
            token,
            (j) => {
              setJob(j);
              updateRecentJob(j.id, { status: j.status });
            },
            abort.signal,
          );
        }
      } catch {
        setNotFound(true);
        setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [jobId, token]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteJobRequest(jobId, token);
      removeRecentJob(jobId);
      toast({ variant: "success", title: "Files deleted" });
      router.push("/");
    } catch (e) {
      toast({
        variant: "error",
        title: "Couldn’t delete",
        description: (e as Error).message,
      });
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading job…
      </div>
    );
  }

  if (notFound || !job) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-semibold">Job not found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              It may have expired and been auto-deleted, or the link is missing
              its access token.
            </p>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" /> Back home
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const primaryInput = job.inputs[0];
  const isWorking = job.status === "pending" || job.status === "processing";
  const isLink = job.inputKind === "link";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusPill status={job.status} />
          <span className="text-sm text-muted-foreground">
            Created {timeAgo(job.createdAt)}
          </span>
        </div>
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" /> Home
          </Button>
        </Link>
      </div>

      {/* Working progress */}
      {isWorking && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Processing your job…</span>
              <span className="text-muted-foreground">{job.progress}%</span>
            </div>
            <Progress value={job.progress} />
          </CardContent>
        </Card>
      )}

      {/* Failed */}
      {job.status === "failed" && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-5">
            <p className="text-sm font-medium text-destructive">
              This job failed
            </p>
            <p className="mt-1 text-sm text-foreground">
              {job.error || "An unexpected error occurred."}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Input info */}
        <Card>
          <CardContent className="py-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileInput className="h-4 w-4 text-muted-foreground" /> Input
            </div>
            <Separator className="mb-3" />
            <dl className="space-y-2 text-sm">
              <Row label="Type" value={job.inputKind} />
              {isLink ? (
                <Row
                  label="Source"
                  value={
                    <span className="break-all">
                      {primaryInput?.originalName}
                    </span>
                  }
                />
              ) : (
                <>
                  <Row
                    label="Files"
                    value={`${job.inputs.length} file${job.inputs.length > 1 ? "s" : ""}`}
                  />
                  <Row
                    label="First file"
                    value={
                      <span className="break-all">
                        {primaryInput?.originalName}
                      </span>
                    }
                  />
                  {primaryInput && (
                    <Row label="Size" value={formatBytes(primaryInput.size)} />
                  )}
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Output info */}
        <Card>
          <CardContent className="py-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FileOutput className="h-4 w-4 text-muted-foreground" /> Output
            </div>
            <Separator className="mb-3" />
            {job.status === "completed" ? (
              <dl className="space-y-2 text-sm">
                <Row
                  label="Result"
                  value={
                    job.bundleName
                      ? "Bundled ZIP"
                      : `${job.outputs.length} file${job.outputs.length > 1 ? "s" : ""}`
                  }
                />
                {job.outputs.slice(0, 5).map((o) => (
                  <Row
                    key={o.name}
                    label={<span className="truncate">{o.name}</span>}
                    value={formatBytes(o.size)}
                  />
                ))}
                {job.outputs.length > 5 && (
                  <p className="text-xs italic text-muted-foreground">
                    +{job.outputs.length - 5} more files
                  </p>
                )}
                {typeof job.params.extractedCount === "number" && (
                  <Row
                    label="Extracted"
                    value={`${job.params.extractedCount} files`}
                  />
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isWorking
                  ? "Your result will appear here when processing finishes."
                  : "No output produced."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {job.status === "completed" && (
          <a
            href={downloadUrl(job.id, token)}
            download
            className="flex-1 sm:flex-none"
          >
            <Button className="w-full sm:w-auto">
              <Download className="h-4 w-4" /> Download result
            </Button>
          </a>
        )}
        <Button
          variant="outline"
          onClick={handleDelete}
          disabled={deleting}
          className="w-full sm:w-auto"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete files
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Job ID: <span className="font-mono">{job.id}</span> · Files auto-delete
        after the retention window. Download soon if you need them.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 capitalize text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  );
}
