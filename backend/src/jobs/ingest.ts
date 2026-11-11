import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs, sources } from '../db/schema.js';
import type { JobSource } from './types.js';
import { rescoreJobs } from './matching.js';

export async function ingestJobs(source: JobSource): Promise<{ fetched: number; inserted: number }> {
  const [registeredSource] = await db.insert(sources)
    .values({ name: source.name, baseUrl: source.baseUrl })
    .onConflictDoUpdate({ target: sources.name, set: { baseUrl: source.baseUrl } })
    .returning({ id: sources.id });
  if (!registeredSource) throw new Error(`Could not register source ${source.name}`);

  const found = await source.fetchJobs();
  let inserted = 0;
  for (const job of found) {
    const values = {
      sourceId: registeredSource.id,
      sourceJobId: job.sourceJobId,
      url: job.url,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      contactEmail: job.contactEmail,
      employmentType: job.employmentType,
      salary: job.salary,
      deadline: job.deadline,
      postedAt: job.postedAt,
    };
    const [existing] = await db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.sourceId, registeredSource.id), eq(jobs.url, job.url))).limit(1);
    if (existing) {
      await db.update(jobs).set({
        ...values,
        updatedAt: new Date(),
      }).where(eq(jobs.id, existing.id));
      continue;
    }
    const result = await db.insert(jobs).values({
      ...values,
    }).onConflictDoNothing({ target: [jobs.sourceId, jobs.url] }).returning({ id: jobs.id });
    inserted += result.length;
  }

  await db.update(sources).set({ lastFetchedAt: new Date() }).where(eq(sources.id, registeredSource.id));
  await rescoreJobs();
  return { fetched: found.length, inserted };
}
