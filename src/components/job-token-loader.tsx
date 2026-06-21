"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { getRecentJobs } from "@/lib/local-store";

/**
 * Resolves the per-job access token for the job page. Prefers the ?token= query
 * param; falls back to the locally-stored token for this job id (so the page
 * still works if the user navigates from history without the token in the URL).
 */
export function JobTokenLoader({
  id,
  children,
}: {
  id: string;
  children: (token: string) => React.ReactNode;
}) {
  const params = useSearchParams();
  const [token, setToken] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fromQuery = params.get("token");
    if (fromQuery) {
      setToken(fromQuery);
      return;
    }
    const local = getRecentJobs().find((j) => j.id === id);
    setToken(local?.token ?? "");
  }, [id, params]);

  if (token === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  return <>{children(token)}</>;
}
