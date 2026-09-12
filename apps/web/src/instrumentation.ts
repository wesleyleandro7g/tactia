/**
 * Node runtime only. Starts pg-boss workers when JOBS_ENABLED=true.
 * Edge/middleware must not load this path (pg-boss needs a long-lived process).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  if (process.env['JOBS_ENABLED'] !== 'true') return;

  const { startJobWorkers } = await import('./lib/jobs');
  await startJobWorkers();
}
