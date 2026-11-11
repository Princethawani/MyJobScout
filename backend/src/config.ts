import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().default('postgres://jobsearch:jobsearch@localhost:5434/jobsearch'),
  AUTH_TOKEN: z.string().min(32).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.preprocess((value) => value === '' ? undefined : value, z.string().email().optional()),
  DOCUMENTS_DIR: z.string().default('./documents'),
  MATCHING_MODE: z.enum(['keyword', 'semantic', 'hybrid']).default('keyword'),
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  EMBEDDING_PROVIDER: z.enum(['ollama', 'gemini']).default('ollama'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
});

export const config = envSchema.parse(process.env);
if (config.NODE_ENV === 'production' && !config.AUTH_TOKEN) {
  throw new Error('AUTH_TOKEN must be configured in production');
}
