/**
 * Next.js instrumentation hook — runs once when the server process boots.
 *
 * We use it to run startup tasks (crash recovery, cleanup worker) and register
 * graceful-shutdown handlers exactly once, instead of lazily on the first
 * request. Only runs in the Node.js runtime (never Edge).
 *
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startup } = await import("@/lib/lifecycle");
    await startup();
  }
}
