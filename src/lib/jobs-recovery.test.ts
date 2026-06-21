import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Crash-recovery test. We point CONVERT_JOBS_DIR at a temp dir BEFORE importing
 * the jobs module (which reads config at import time), seed an on-disk job stuck
 * in "processing", and assert recovery marks it "failed".
 */

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kt-recovery-"));
  process.env.CONVERT_JOBS_DIR = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("recoverInterruptedJobs", () => {
  it("marks stuck 'processing' jobs as failed and rehydrates others", async () => {
    // Seed two jobs on disk: one stuck processing, one completed.
    const stuckId = "stuckjob1234abcd"; // 16 chars, valid id shape
    const doneId = "donejob5678efgh";

    const stuckDir = path.join(tmpDir, stuckId);
    const doneDir = path.join(tmpDir, doneId);
    await fs.mkdir(stuckDir, { recursive: true });
    await fs.mkdir(doneDir, { recursive: true });

    const now = Date.now();
    await fs.writeFile(
      path.join(stuckDir, "metadata.json"),
      JSON.stringify({
        id: stuckId,
        token: "t".repeat(32),
        status: "processing",
        createdAt: now,
        updatedAt: now,
        progress: 42,
        params: {},
        inputs: [],
        outputs: [],
        inputKind: "image",
      }),
    );
    await fs.writeFile(
      path.join(doneDir, "metadata.json"),
      JSON.stringify({
        id: doneId,
        token: "u".repeat(32),
        status: "completed",
        createdAt: now,
        updatedAt: now,
        progress: 100,
        params: {},
        inputs: [],
        outputs: [{ name: "x.webp", size: 10, mime: "image/webp" }],
        inputKind: "image",
      }),
    );

    const jobs = await import("./jobs");
    const recovered = await jobs.recoverInterruptedJobs();
    expect(recovered).toBe(1);

    const stuck = await jobs.getJob(stuckId);
    expect(stuck?.status).toBe("failed");
    expect(stuck?.error).toMatch(/restart/i);

    const done = await jobs.getJob(doneId);
    expect(done?.status).toBe("completed");
  });
});
