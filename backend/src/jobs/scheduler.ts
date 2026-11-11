import type { FastifyBaseLogger } from 'fastify';
import { ingestJobs } from './ingest.js';
import { JobSearchMalawiSource } from './sources/job-search-malawi.js';

const intervalMs = 4 * 60 * 60 * 1000;

export function startJobCollection(logger: FastifyBaseLogger): () => void {
  const sources = [new JobSearchMalawiSource()];
  let running = false;

  const collect = async () => {
    if (running) return;
    running = true;
    try {
      for (const source of sources) {
        try {
          const result = await ingestJobs(source);
          logger.info({ source: source.name, ...result }, 'Job collection completed');
        } catch (error) {
          logger.error({ err: error, source: source.name }, 'Job collection failed');
        }
        // Keep a small pause between sources as more adapters are added.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } finally {
      running = false;
    }
  };

  void collect();
  const timer = setInterval(() => void collect(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
