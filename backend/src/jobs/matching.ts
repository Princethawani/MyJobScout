import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { jobs, profile } from '../db/schema.js';

type ProfileData = Record<string, unknown>;
type MatchableJob = { title: string; company?: string | null; location?: string | null; description?: string | null };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

export function calculateJobMatch(job: MatchableJob, data: ProfileData) {
  const text = `${job.title} ${job.company ?? ''} ${job.description ?? ''}`.toLowerCase();
  const skills = strings(data.skills);
  const matchedSkills = skills.filter((skill) => text.includes(skill.toLowerCase()));
  const missingSkills = skills.filter((skill) => !matchedSkills.includes(skill));
  const preferredLocations = strings(data.preferredLocations);
  const locationMatched = preferredLocations.length > 0
    ? preferredLocations.some((location) => (job.location ?? '').toLowerCase().includes(location.toLowerCase()))
    : undefined;
  const seniorityTerms = strings(data.seniority);
  const seniorityMatched = seniorityTerms.length > 0
    ? seniorityTerms.some((term) => text.includes(term.toLowerCase()))
    : undefined;

  const components: Array<{ weight: number; score: number }> = [];
  if (skills.length) components.push({ weight: 0.7, score: matchedSkills.length / skills.length });
  if (locationMatched !== undefined) components.push({ weight: 0.2, score: Number(locationMatched) });
  if (seniorityMatched !== undefined) components.push({ weight: 0.1, score: Number(seniorityMatched) });
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const fitScore = totalWeight === 0 ? null : Math.round(100 * components.reduce((sum, component) => sum + component.weight * component.score, 0) / totalWeight);

  return {
    fitScore,
    scoreDetails: { method: 'local-keyword', matchedSkills, missingSkills, locationMatched, seniorityMatched },
  };
}

export async function createEmbedding(text: string): Promise<number[] | null> {
  try {
    const clippedText = text.slice(0, 12_000);
    const response = config.EMBEDDING_PROVIDER === 'gemini'
      ? config.GEMINI_API_KEY
        ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_EMBEDDING_MODEL}:embedContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY },
          body: JSON.stringify({
            model: `models/${config.GEMINI_EMBEDDING_MODEL}`,
            content: { parts: [{ text: config.GEMINI_EMBEDDING_MODEL === 'gemini-embedding-2' ? `task: sentence similarity | query: ${clippedText}` : clippedText }] },
            ...(config.GEMINI_EMBEDDING_MODEL === 'gemini-embedding-2' ? {} : { taskType: 'SEMANTIC_SIMILARITY' }),
            outputDimensionality: 768,
          }),
          signal: AbortSignal.timeout(30_000),
        })
        : null
      : await fetch(`${config.OLLAMA_BASE_URL.replace(/\/$/, '')}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: config.OLLAMA_EMBEDDING_MODEL, input: clippedText }),
        signal: AbortSignal.timeout(30_000),
      });
    if (!response) return null;
    if (!response.ok) return null;
    const body = await response.json() as { embeddings?: unknown; embedding?: { values?: unknown } };
    const vector = config.EMBEDDING_PROVIDER === 'gemini'
      ? body.embedding?.values
      : Array.isArray(body.embeddings) ? body.embeddings[0] : undefined;
    return Array.isArray(vector) && vector.length > 0 && vector.every((value) => typeof value === 'number')
      ? vector as number[]
      : null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(left: number[], right: number[]): number | null {
  if (!left.length || left.length !== right.length) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  if (!leftMagnitude || !rightMagnitude) return null;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function profileText(data: ProfileData): string {
  return [data.summary, ...strings(data.skills), ...strings(data.roles), ...strings(data.education), ...strings(data.preferredLocations), ...strings(data.seniority)]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
}

function jobText(job: MatchableJob): string {
  return [job.title, job.company, job.location, job.description].filter(Boolean).join('\n');
}

export async function rescoreJobs(): Promise<void> {
  const [stored] = await db.select().from(profile).limit(1);
  const profileData = stored?.data as ProfileData | undefined;
  if (!stored || !profileData) return;
  const allJobs = await db.select().from(jobs);

  let profileVector = stored.embedding;
  const profileContent = profileText(profileData);
  const embeddingModel = `${config.EMBEDDING_PROVIDER}:${config.EMBEDDING_PROVIDER === 'gemini' ? config.GEMINI_EMBEDDING_MODEL : config.OLLAMA_EMBEDDING_MODEL}`;
  if (config.MATCHING_MODE !== 'keyword' && (!profileVector || stored.embeddingModel !== embeddingModel) && profileContent) {
    profileVector = await createEmbedding(profileContent);
    if (profileVector) await db.update(profile).set({ embedding: profileVector, embeddingModel }).where(eq(profile.id, stored.id));
  }

  for (const job of allJobs) {
    const keyword = calculateJobMatch(job, profileData);
    let jobVector = job.embedding;
    if (config.MATCHING_MODE !== 'keyword' && profileVector && (!jobVector || job.embeddingModel !== embeddingModel)) {
      jobVector = await createEmbedding(jobText(job));
    }
    const similarity = profileVector && jobVector ? cosineSimilarity(profileVector, jobVector) : null;
    const semanticScore = similarity === null ? null : Math.round(Math.max(0, Math.min(1, similarity)) * 100);
    let fitScore = keyword.fitScore;
    let method = 'local-keyword';
    if (semanticScore !== null && config.MATCHING_MODE === 'semantic') {
      fitScore = semanticScore;
      method = `${config.EMBEDDING_PROVIDER}-semantic`;
    } else if (semanticScore !== null && config.MATCHING_MODE === 'hybrid') {
      fitScore = keyword.fitScore === null ? semanticScore : Math.round(semanticScore * 0.7 + keyword.fitScore * 0.3);
      method = `${config.EMBEDDING_PROVIDER}-hybrid`;
    } else if (config.MATCHING_MODE !== 'keyword') {
      method = 'local-keyword-fallback';
    }
    await db.update(jobs).set({
      fitScore,
      embedding: jobVector,
      embeddingModel: jobVector ? embeddingModel : job.embeddingModel,
      scoreDetails: { ...keyword.scoreDetails, method, keywordScore: keyword.fitScore, semanticScore },
      updatedAt: new Date(),
    }).where(eq(jobs.id, job.id));
  }
}
