import { relations } from 'drizzle-orm';
import { integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  baseUrl: text('base_url').notNull(),
  enabled: integer('enabled').notNull().default(1),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ nameUnique: uniqueIndex('sources_name_unique').on(table.name) }));

export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  sourceJobId: varchar('source_job_id', { length: 255 }),
  url: text('url').notNull(),
  title: text('title').notNull(),
  company: text('company'),
  location: text('location'),
  description: text('description'),
  contactEmail: varchar('contact_email', { length: 320 }),
  employmentType: varchar('employment_type', { length: 80 }),
  salary: text('salary'),
  deadline: timestamp('deadline', { withTimezone: true }),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  fitScore: real('fit_score'),
  scoreDetails: jsonb('score_details'),
  embedding: jsonb('embedding').$type<number[]>(),
  embeddingModel: varchar('embedding_model', { length: 120 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ sourceUrlUnique: uniqueIndex('jobs_source_url_unique').on(table.sourceId, table.url) }));

export const profile = pgTable('profile', {
  id: uuid('id').defaultRandom().primaryKey(),
  data: jsonb('data').notNull().default({}),
  embedding: jsonb('embedding').$type<number[]>(),
  embeddingModel: varchar('embedding_model', { length: 120 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  documentType: varchar('document_type', { length: 80 }).notNull(),
  storagePath: text('storage_path').notNull(),
  mimeType: varchar('mime_type', { length: 120 }),
  defaultFor: jsonb('default_for').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const applications = pgTable('applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 40 }).notNull().default('found'),
  letter: text('letter'),
  letterVersion: integer('letter_version').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ jobUnique: uniqueIndex('applications_job_unique').on(table.jobId) }));

export const letterVersions = pgTable('letter_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  applicationId: uuid('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ versionUnique: uniqueIndex('letter_versions_application_version_unique').on(table.applicationId, table.version) }));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  source: one(sources, { fields: [jobs.sourceId], references: [sources.id] }),
  applications: many(applications),
}));
export const applicationsRelations = relations(applications, ({ one }) => ({
  job: one(jobs, { fields: [applications.jobId], references: [jobs.id] }),
}));
