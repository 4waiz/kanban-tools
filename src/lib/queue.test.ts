import { describe, it, expect } from "vitest";
import { WorkQueue, QueueFullError } from "./queue";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("WorkQueue", () => {
  it("never exceeds the configured concurrency", async () => {
    const q = new WorkQueue({ concurrency: 2, maxQueueDepth: 100 });
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 8 }, (_, i) =>
      q.enqueue(`t${i}`, async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await tick(15);
        running--;
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(maxRunning).toBeGreaterThan(0);
  });

  it("applies backpressure when the backlog is full", async () => {
    // concurrency 1, queue depth 1 → 1 running + 1 waiting is the max.
    const q = new WorkQueue({ concurrency: 1, maxQueueDepth: 1 });

    const first = q.enqueue("a", async () => {
      await tick(40);
      return "a";
    });
    // This one waits in the queue (depth now 1).
    const second = q.enqueue("b", async () => "b");

    // Third should be rejected synchronously: backlog full.
    expect(() => q.enqueue("c", async () => "c")).toThrow(QueueFullError);

    expect(await first).toBe("a");
    expect(await second).toBe("b");
  });

  it("isolates task errors to their own promise", async () => {
    const q = new WorkQueue({ concurrency: 2, maxQueueDepth: 10 });
    const ok = q.enqueue("ok", async () => "fine");
    const bad = q.enqueue("bad", async () => {
      throw new Error("boom");
    });

    await expect(bad).rejects.toThrow("boom");
    await expect(ok).resolves.toBe("fine");
    // Queue keeps working after an error.
    await expect(q.enqueue("after", async () => "still works")).resolves.toBe(
      "still works",
    );
  });

  it("drain() resolves true once in-flight work finishes", async () => {
    const q = new WorkQueue({ concurrency: 2, maxQueueDepth: 10 });
    let done = 0;
    for (let i = 0; i < 4; i++) {
      void q.enqueue(`d${i}`, async () => {
        await tick(10);
        done++;
      });
    }
    const drained = await q.drain(1000);
    expect(drained).toBe(true);
    expect(done).toBe(4);
  });

  it("drain() rejects new work after it starts", async () => {
    const q = new WorkQueue({ concurrency: 1, maxQueueDepth: 10 });
    void q.enqueue("x", async () => tick(20));
    const drainPromise = q.drain(1000);
    expect(() => q.enqueue("y", async () => "nope")).toThrow(QueueFullError);
    await drainPromise;
  });
});
