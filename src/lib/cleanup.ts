import "server-only";
import { startup } from "./lifecycle";

/**
 * Back-compat shim. Startup (cleanup worker + crash recovery + shutdown
 * handlers) is owned by `lifecycle.startup()`, invoked from instrumentation.ts
 * at boot. This thin wrapper lets route handlers ensure startup ran even in
 * environments where the instrumentation hook didn't fire. `startup()` is
 * idempotent, so calling it repeatedly is safe and cheap.
 */
export function ensureCleanupWorker(): void {
  void startup();
}
