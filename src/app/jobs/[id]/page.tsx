import { Suspense } from "react";
import { JobDetail } from "@/components/job-detail";
import { JobTokenLoader } from "@/components/job-token-loader";

export const metadata = {
  title: "Job — Kanban Tools",
};

/**
 * Job result page. The access token comes from the query string (?token=...).
 * We resolve it on the client (JobTokenLoader) so a token can also be recovered
 * from local storage if the URL omits it.
 */
export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="container max-w-3xl py-12">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Job result</h1>
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading…</p>
        }
      >
        <JobTokenLoader id={id}>
          {(token) => <JobDetail jobId={id} token={token} />}
        </JobTokenLoader>
      </Suspense>
    </div>
  );
}
