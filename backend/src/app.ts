import Fastify from 'fastify';
import { resolve, relative, isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createTransport } from 'nodemailer';
import PDFDocument from 'pdfkit';
import multipart from '@fastify/multipart';
import { mkdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from './config.js';
import { db } from './db/index.js';
import { applications, documents, jobFeedback, jobs, letterVersions, profile } from './db/schema.js';
import { extractProfile } from './profile/cv-parser.js';
import { calculateJobMatch, rescoreJobs } from './jobs/matching.js';

function renderLetterPdf(letter: string): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', margins: { top: 60, right: 57, bottom: 57, left: 57 } });
  const chunks: Buffer[] = [];
  const content = new Promise<Buffer>((resolvePdf, rejectPdf) => {
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolvePdf(Buffer.concat(chunks)));
    pdf.on('error', rejectPdf);
  });

  const lines = letter.split(/\r?\n/);
  const headerEnd = lines.findIndex((line) => !line.trim());
  if (headerEnd < 0) {
    pdf.font('Times-Roman').fontSize(12).text(letter, { lineGap: 3, align: 'justify' });
    pdf.end();
    return content;
  }

  const header = lines.slice(0, headerEnd).filter((line) => line.trim());
  const rest = lines.slice(headerEnd + 1);
  const recipientEnd = rest.findIndex((line) => /^Dear\s/i.test(line.trim()));
  const recipient = recipientEnd < 0 ? [] : rest.slice(0, recipientEnd).filter((line) => line.trim());
  const afterRecipient = recipientEnd < 0 ? rest : rest.slice(recipientEnd + 1);
  const salutation = recipientEnd < 0 ? '' : rest[recipientEnd].trim();
  const bodyStart = afterRecipient.findIndex((line) => /^Application for\s/i.test(line.trim()));
  const subject = bodyStart < 0 ? '' : afterRecipient[bodyStart].trim();
  const body = (bodyStart < 0 ? afterRecipient : afterRecipient.slice(bodyStart + 1)).join('\n').trim();
  const pageWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const headerWidth = pageWidth - 40;

  pdf.font('Times-Roman').fontSize(12);
  header.forEach((line, index) => {
    const isName = index === 0;
    const isLink = /^(?:https?:\/\/|www\.)|^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(line.trim());
    pdf.font(isName ? 'Times-Bold' : 'Times-Roman');
    if (isLink) {
      const url = line.trim().startsWith('www.') ? `https://${line.trim()}` : line.trim();
      pdf.fillColor('#0000aa').text(line, { width: headerWidth, align: 'right', lineGap: 2, link: url, underline: true });
      pdf.fillColor('#000000');
    } else {
      pdf.text(line, { width: headerWidth, align: 'right', lineGap: 2 });
    }
  });

  pdf.moveDown(0.9);
  recipient.forEach((line) => pdf.font('Times-Roman').text(line, { lineGap: 2 }));
  if (salutation) {
    pdf.moveDown(0.65);
    pdf.text(salutation, { lineGap: 2 });
  }
  if (subject) {
    pdf.moveDown(0.65);
    pdf.font('Times-Bold').text(subject, { lineGap: 2 });
    pdf.font('Times-Roman');
  }
  if (body) {
    for (const paragraph of body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean)) {
      pdf.moveDown(0.55);
      const isList = paragraph.split('\n').every((line) => /^\s*[•*-]\s+/.test(line));
      pdf.text(paragraph, { align: isList ? 'left' : 'justify', lineGap: 2, ...(isList ? { indent: 12 } : {}) });
    }
  }
  pdf.end();
  return content;
}

function selectRelevantEntries(entries: unknown, jobText: string, maximum: number): string[] {
  if (!Array.isArray(entries)) return [];
  const stopWords = new Set(['with', 'from', 'that', 'this', 'will', 'have', 'your', 'their', 'about', 'into', 'must', 'should', 'the', 'and', 'for', 'you', 'are', 'our', 'who', 'how']);
  const terms = [...new Set(jobText.toLowerCase().match(/[a-z][a-z+.#-]{3,}/g) ?? [])].filter((term) => !stopWords.has(term));
  return entries
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => ({ entry: entry.trim(), score: terms.filter((term) => entry.toLowerCase().includes(term)).length }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maximum)
    .map((item) => item.entry);
}

function cleanListEntry(entry: string): string {
  return entry
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/[\s.;,]+$/, '')
    .trim();
}

export function buildApp() {
  const app = Fastify({ logger: true });
  void app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  if (config.AUTH_TOKEN) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url === '/health') return;
      const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (supplied !== config.AUTH_TOKEN) return reply.code(401).send({ error: 'Unauthorized' });
    });
  }
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/profile', async () => {
    const [stored] = await db.select().from(profile).limit(1);
    return { profile: stored?.data ?? {} };
  });
  app.post('/profile/import-cv', async (request, reply) => {
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: 'Upload one PDF or DOCX CV file' });
    const extension = upload.filename.toLowerCase().endsWith('.pdf') ? 'pdf'
      : upload.filename.toLowerCase().endsWith('.docx') ? 'docx' : null;
    if (!extension) return reply.code(415).send({ error: 'Only PDF and DOCX files are supported' });
    let buffer: Buffer;
    try { buffer = await upload.toBuffer(); }
    catch { return reply.code(413).send({ error: 'CV exceeds the 10 MB upload limit' }); }
    let extractedText: string;
    try {
      extractedText = extension === 'pdf'
        ? (await pdfParse(buffer)).text
        : (await mammoth.extractRawText({ buffer })).value;
    } catch {
      return reply.code(422).send({ error: 'Could not read this file. Try a text-based PDF or DOCX document.' });
    }
    if (!extractedText.trim()) return reply.code(422).send({ error: 'No text could be extracted. Scanned image PDFs are not supported yet.' });
    const extractedProfile = extractProfile(extractedText);
    const directory = resolve(config.DOCUMENTS_DIR);
    const filename = `cv-${randomUUID()}.${extension}`;
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, filename), buffer, { flag: 'wx', mode: 0o600 });
    const [document] = await db.insert(documents).values({
      name: upload.filename.slice(0, 255), documentType: 'cv', storagePath: filename,
      mimeType: extension === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      defaultFor: ['all'],
    }).returning({ id: documents.id, name: documents.name, documentType: documents.documentType });
    return reply.code(201).send({ extractedProfile, document, extractedText });
  });
  app.put('/profile', async (request, reply) => {
    const bodySchema = z.record(z.unknown());
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Profile must be a JSON object' });
    const [stored] = await db.select({ id: profile.id }).from(profile).limit(1);
    if (stored) {
      await db.update(profile).set({ data: parsed.data, embedding: null, updatedAt: new Date() }).where(eq(profile.id, stored.id));
    } else {
      await db.insert(profile).values({ data: parsed.data });
    }
    await rescoreJobs();
    return { profile: parsed.data };
  });
  app.get('/documents', async () => ({ documents: await db.select().from(documents) }));
  app.delete<{ Params: { id: string } }>('/documents/:id', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: 'Invalid document id' });
    const [existing] = await db.select().from(documents).where(eq(documents.id, parsedId.data)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'Document not found' });

    const root = resolve(config.DOCUMENTS_DIR);
    const filePath = resolve(root, existing.storagePath);
    const subPath = relative(root, filePath);
    if (subPath.startsWith('..') || isAbsolute(subPath)) {
      return reply.code(409).send({ error: 'Stored file is outside the configured documents folder; it was not deleted' });
    }
    try {
      const realRoot = await realpath(root);
      let realFilePath: string | null = null;
      try { realFilePath = await realpath(filePath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (realFilePath) {
        const realSubPath = relative(realRoot, realFilePath);
        if (realSubPath.startsWith('..') || isAbsolute(realSubPath)) {
          return reply.code(409).send({ error: 'Stored file resolves outside the configured documents folder; it was not deleted' });
        }
        await unlink(realFilePath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        request.log.error({ err: error, documentId: existing.id }, 'Document file could not be removed');
        return reply.code(500).send({ error: 'Could not remove the stored file' });
      }
    }
    await db.delete(documents).where(eq(documents.id, existing.id));
    return { deleted: true };
  });
  app.post('/documents', async (request, reply) => {
    const bodySchema = z.object({
      name: z.string().min(1).max(255),
      documentType: z.string().min(1).max(80),
      storagePath: z.string().min(1),
      mimeType: z.string().max(120).optional(),
      defaultFor: z.array(z.string()).default([]),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid document metadata', details: parsed.error.flatten() });
    const [created] = await db.insert(documents).values(parsed.data).returning();
    return reply.code(201).send({ document: created });
  });
  app.post<{ Params: { id: string } }>('/jobs/:id/score', async (request, reply) => {
    const id = z.string().uuid().safeParse(request.params.id);
    if (!id.success) return reply.code(400).send({ error: 'Invalid job id' });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id.data)).limit(1);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    await rescoreJobs();
    const [rescored] = await db.select().from(jobs).where(eq(jobs.id, job.id)).limit(1);
    return { jobId: job.id, fitScore: rescored.fitScore, ...rescored.scoreDetails as Record<string, unknown> };
  });
  app.get('/jobs', async (request, reply) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
      minScore: z.coerce.number().min(0).max(100).optional(),
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query parameters', details: parsed.error.flatten() });
    }

    const { limit, offset, minScore } = parsed.data;
    const ordering = [desc(sql`coalesce(${jobs.fitScore}, -1)`), desc(jobs.createdAt)];
    const query = db.select().from(jobs).orderBy(...ordering).limit(limit).offset(offset);
    const rows = minScore === undefined
      ? await query
      : await db.select().from(jobs).where(gte(jobs.fitScore, minScore))
        .orderBy(...ordering).limit(limit).offset(offset);
    const feedbackRows = rows.length
      ? await db.select({ jobId: jobFeedback.jobId, rating: jobFeedback.rating }).from(jobFeedback)
        .where(inArray(jobFeedback.jobId, rows.map((job) => job.id)))
      : [];
    const feedbackByJobId = new Map(feedbackRows.map((feedback) => [feedback.jobId, feedback.rating]));
    return { jobs: rows.map((job) => ({ ...job, feedback: feedbackByJobId.get(job.id) ?? null })), limit, offset };
  });
  app.put<{ Params: { id: string } }>('/jobs/:id/feedback', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const body = z.object({ rating: z.enum(['relevant', 'not_relevant']) }).safeParse(request.body);
    if (!parsedId.success || !body.success) return reply.code(400).send({ error: 'Invalid job id or feedback rating' });
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, parsedId.data)).limit(1);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    const [feedback] = await db.insert(jobFeedback).values({ jobId: job.id, rating: body.data.rating, updatedAt: new Date() })
      .onConflictDoUpdate({ target: jobFeedback.jobId, set: { rating: body.data.rating, updatedAt: new Date() } })
      .returning({ jobId: jobFeedback.jobId, rating: jobFeedback.rating, updatedAt: jobFeedback.updatedAt });
    return { feedback };
  });
  app.delete<{ Params: { id: string } }>('/jobs/:id/feedback', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: 'Invalid job id' });
    await db.delete(jobFeedback).where(eq(jobFeedback.jobId, parsedId.data));
    return { feedback: null };
  });
  app.post<{ Params: { id: string } }>('/jobs/:id/draft', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: 'Invalid job id' });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, parsedId.data)).limit(1);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    const [cv] = await db.select({ id: documents.id }).from(documents).where(eq(documents.documentType, 'cv')).limit(1);
    if (!cv) return reply.code(409).send({ error: 'Upload your CV from the Profile page before drafting an application' });
    const [stored] = await db.select().from(profile).limit(1);
    const person = stored?.data as { name?: string; email?: string; phone?: string; address?: string; location?: string; website?: string; summary?: string; skills?: unknown[]; roles?: unknown[]; education?: unknown[] } | undefined;
    if (!person?.name) return reply.code(409).send({ error: 'Add your name to the profile before drafting a letter' });
    const matchedSkills = calculateJobMatch(job, person as Record<string, unknown>).scoreDetails.matchedSkills;
    const roleMatches = selectRelevantEntries(person.roles, `${job.title} ${job.description ?? ''}`, 2);
    const educationMatches = selectRelevantEntries(person.education, `${job.title} ${job.description ?? ''}`, 2);
    const facts = [person.name, person.email, person.phone, person.address, person.location, person.website, person.summary, ...roleMatches, ...educationMatches, ...matchedSkills].filter((value): value is string => Boolean(value));
    const experienceParagraph = roleMatches.length
      ? `My relevant professional experience includes:\n${roleMatches.map((role) => `• ${cleanListEntry(role)}.`).join('\n')}`
      : null;
    const educationParagraph = educationMatches.length
      ? `My relevant education and qualifications include ${educationMatches.map(cleanListEntry).join('; ')}.`
      : null;
    const skillsParagraph = matchedSkills.length
      ? `My experience includes skills relevant to this position, including ${matchedSkills.join(', ')}.`
      : null;
    const letter = [
      person.name,
      person.address ?? person.location,
      person.phone,
      person.email,
      person.website,
      new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      '',
      'Recruitment Office',
      job.company ?? 'Hiring Organisation',
      job.location && !/^(various|multiple|nationwide|not specified)$/i.test(job.location.trim()) ? job.location : 'Malawi',
      'Dear Sir/Madam,',
      '',
      `Application for ${job.title}`,
      '',
      `I am writing to apply for the ${job.title} position${job.company ? ` at ${job.company}` : ''}, as advertised.`,
      ...(person.summary ? ['', person.summary] : []),
      ...(educationParagraph ? ['', educationParagraph] : []),
      ...(experienceParagraph ? ['', experienceParagraph] : []),
      ...(skillsParagraph ? ['', skillsParagraph] : []),
      '',
      'I am confident that my relevant experience and skills would enable me to contribute to the role. Please find my CV attached for your consideration. I would welcome the opportunity to discuss my application further.',
      '',
      'Yours faithfully,',
      person.name,
    ].filter((line): line is string => typeof line === 'string').join('\n');
    const [existing] = await db.select().from(applications).where(eq(applications.jobId, job.id)).limit(1);
    if (existing?.sentAt) return reply.code(409).send({ error: 'An application has already been sent for this job' });
    const [application] = existing
      ? await db.update(applications).set({ letter, letterVersion: existing.letterVersion + 1, status: 'drafted', updatedAt: new Date() }).where(eq(applications.id, existing.id)).returning()
      : await db.insert(applications).values({ jobId: job.id, status: 'drafted', letter, letterVersion: 1 }).returning();
    await db.insert(letterVersions).values({ applicationId: application.id, version: application.letterVersion, content: letter });
    return { application, factualProfileFieldsUsed: facts, recommendedDocumentIds: [cv.id] };
  });
  app.get('/applications', async () => ({ applications: await db.select().from(applications) }));
  app.delete<{ Params: { id: string } }>('/applications/:id', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: 'Invalid application id' });
    const [existing] = await db.select().from(applications).where(eq(applications.id, parsedId.data)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'Application not found' });
    if (existing.status === 'sending') return reply.code(409).send({ error: 'An application cannot be removed while it is being sent' });
    if (existing.sentAt || ['sent', 'replied', 'rejected', 'interview'].includes(existing.status)) {
      const [updated] = await db.update(applications).set({ status: 'withdrawn', updatedAt: new Date() })
        .where(and(eq(applications.id, existing.id), ne(applications.status, 'sending'))).returning();
      if (!updated) return reply.code(409).send({ error: 'An application cannot be removed while it is being sent' });
      return { application: updated, withdrawn: true };
    }
    const [deleted] = await db.delete(applications).where(and(
      eq(applications.id, existing.id), ne(applications.status, 'sending'), isNull(applications.sentAt),
    )).returning({ id: applications.id });
    if (!deleted) return reply.code(409).send({ error: 'Application status changed; refresh and try again' });
    return { deleted: true };
  });
  app.patch<{ Params: { id: string } }>('/applications/:id/letter', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const body = z.object({ letter: z.string().min(1).max(20_000) }).safeParse(request.body);
    if (!parsedId.success || !body.success) return reply.code(400).send({ error: 'Invalid application id or letter' });
    const [existing] = await db.select().from(applications).where(eq(applications.id, parsedId.data)).limit(1);
    if (!existing) return reply.code(404).send({ error: 'Application not found' });
    if (existing.sentAt) return reply.code(409).send({ error: 'Sent letters cannot be edited' });
    const version = existing.letterVersion + 1;
    const [updated] = await db.update(applications).set({ letter: body.data.letter, letterVersion: version, status: 'drafted', updatedAt: new Date() }).where(eq(applications.id, existing.id)).returning();
    await db.insert(letterVersions).values({ applicationId: existing.id, version, content: body.data.letter });
    return { application: updated };
  });
  app.get<{ Params: { id: string } }>('/applications/:id/versions', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: 'Invalid application id' });
    return { versions: await db.select().from(letterVersions).where(eq(letterVersions.applicationId, parsedId.data)) };
  });
  app.get<{ Params: { id: string } }>('/applications/:id/letter.pdf', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: 'Invalid application id' });
    const [application] = await db.select().from(applications).where(eq(applications.id, parsedId.data)).limit(1);
    if (!application?.letter) return reply.code(404).send({ error: 'Letter not found' });
    const content = await renderLetterPdf(application.letter);
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="application-${application.id}.pdf"`).send(content);
  });
  app.post<{ Params: { id: string } }>('/applications/:id/send-preview', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const body = z.object({ documentIds: z.array(z.string().uuid()).default([]) }).safeParse(request.body ?? {});
    if (!parsedId.success || !body.success) return reply.code(400).send({ error: 'Invalid application id or document list' });
    const [application] = await db.select().from(applications).where(eq(applications.id, parsedId.data)).limit(1);
    if (!application) return reply.code(404).send({ error: 'Application not found' });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1);
    if (!job?.contactEmail) return reply.code(409).send({ error: 'No recipient email is available; apply manually' });
    if (!application.letter) return reply.code(409).send({ error: 'Draft a letter before sending' });
    const selected = body.data.documentIds.length
      ? await db.select().from(documents).where(inArray(documents.id, body.data.documentIds))
      : [];
    if (!selected.some((document) => document.documentType === 'cv')) {
      return reply.code(409).send({ error: 'Your CV must be included with the application' });
    }
    return {
      applicationId: application.id,
      recipient: job.contactEmail,
      subject: `Application: ${job.title}`,
      letter: application.letter,
      letterVersion: application.letterVersion,
      documents: selected.map(({ id, name, documentType }) => ({ id, name, documentType })),
      confirmationRequired: true,
    };
  });
  app.post<{ Params: { id: string } }>('/applications/:id/send-confirm', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const body = z.object({ confirm: z.literal(true), letterVersion: z.number().int().positive(), documentIds: z.array(z.string().uuid()).default([]) }).safeParse(request.body);
    if (!parsedId.success || !body.success) return reply.code(400).send({ error: 'Explicit confirmation, current letterVersion, and valid document ids are required' });
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS || !config.MAIL_FROM) return reply.code(503).send({ error: 'SMTP is not configured' });
    const [application] = await db.select().from(applications).where(eq(applications.id, parsedId.data)).limit(1);
    if (!application || !application.letter) return reply.code(404).send({ error: 'Application or letter not found' });
    if (application.sentAt || application.status === 'sending') return reply.code(409).send({ error: 'Already sent or currently sending' });
    if (application.status !== 'drafted' || application.letterVersion !== body.data.letterVersion) return reply.code(409).send({ error: 'Draft changed since review; preview and confirm the latest version' });
    const [job] = await db.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1);
    if (!job?.contactEmail) return reply.code(409).send({ error: 'No recipient email is available' });
    const [locked] = await db.update(applications).set({ status: 'sending', updatedAt: new Date() })
      .where(and(eq(applications.id, application.id), eq(applications.status, 'drafted'), eq(applications.letterVersion, body.data.letterVersion)))
      .returning({ id: applications.id });
    if (!locked) return reply.code(409).send({ error: 'Application is already being processed' });
    try {
      const selected = body.data.documentIds.length
        ? await db.select().from(documents).where(inArray(documents.id, body.data.documentIds))
        : [];
      if (selected.length !== body.data.documentIds.length) throw new Error('One or more selected documents were not found');
      if (!selected.some((document) => document.documentType === 'cv')) throw new Error('Your CV must be included with the application');
      const attachments = await Promise.all(selected.map(async (document) => {
        const root = resolve(config.DOCUMENTS_DIR);
        const filePath = resolve(root, document.storagePath);
        const subPath = relative(root, filePath);
        if (subPath.startsWith('..') || isAbsolute(subPath)) throw new Error(`Document path is outside DOCUMENTS_DIR: ${document.name}`);
        return { filename: document.name, content: await readFile(filePath) };
      }));
      attachments.unshift({ filename: 'Cover-Letter.pdf', content: Buffer.from(await renderLetterPdf(application.letter)) });
      const transport = createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_PORT === 465, auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } });
      await transport.sendMail({ from: config.MAIL_FROM, to: job.contactEmail, subject: `Application: ${job.title}`, text: application.letter, attachments });
      const [updated] = await db.update(applications).set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() }).where(eq(applications.id, application.id)).returning();
      return { application: updated, sent: true };
    } catch (error) {
      await db.update(applications).set({ status: 'drafted', updatedAt: new Date() }).where(eq(applications.id, application.id));
      request.log.error({ err: error }, 'Application email could not be sent');
      return reply.code(502).send({ error: 'Email send failed; application returned to draft for retry' });
    }
  });
  app.patch<{ Params: { id: string } }>('/applications/:id/status', async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.id);
    const body = z.object({ status: z.enum(['found', 'drafted', 'sent', 'replied', 'rejected', 'interview']) }).safeParse(request.body);
    if (!parsedId.success || !body.success) return reply.code(400).send({ error: 'Invalid application id or status' });
    const [updated] = await db.update(applications).set({ status: body.data.status, updatedAt: new Date() }).where(eq(applications.id, parsedId.data)).returning();
    if (!updated) return reply.code(404).send({ error: 'Application not found' });
    return { application: updated };
  });
  return app;
}
