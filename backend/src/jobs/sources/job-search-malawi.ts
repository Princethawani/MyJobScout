import { load } from 'cheerio';
import type { Job, JobSource } from '../types.js';

const LISTING_URL = 'https://jobsearchmalawi.com/?post_type=job_listing';
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Public listing-page adapter; requests are deliberately sequential and limited. */
export class JobSearchMalawiSource implements JobSource {
  readonly name = 'Job Search Malawi';
  readonly baseUrl = 'https://jobsearchmalawi.com';

  async fetchJobs(): Promise<Job[]> {
    const response = await fetch(LISTING_URL, {
      headers: { 'user-agent': 'JobSearchPersonalAggregator/0.1 (polite job listing indexer)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Job Search Malawi returned HTTP ${response.status}`);

    const html = await response.text();
    const $ = load(html);
    const jobs: Job[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, element) => {
      const anchor = $(element);
      const rawUrl = anchor.attr('href');
      const title = anchor.text().replace(/\s+/g, ' ').trim();
      if (!rawUrl || !title || !/\/job\//.test(rawUrl)) return;

      const url = new URL(rawUrl, this.baseUrl).href.split('#')[0];
      if (seen.has(url)) return;
      seen.add(url);

      const card = anchor.closest('article, .job_listing, li');
      const context = card.length ? card : anchor.parent();
      const dateText = context.find('time').first().attr('datetime');
      jobs.push({
        url,
        title,
        company: context.find('.company strong, .company').first().text().trim() || undefined,
        location: context.find('.location').first().text().trim() || undefined,
        postedAt: dateText && !Number.isNaN(Date.parse(dateText)) ? new Date(dateText) : undefined,
      });
    });

    // Enrich each listing with its complete public description and application contact.
    // Requests are sequential and spaced out to avoid hammering the source site.
    for (const job of jobs.slice(0, 20)) {
      try {
        const detailResponse = await fetch(job.url, {
          headers: { 'user-agent': 'JobSearchPersonalAggregator/0.1 (polite job listing indexer)' },
          signal: AbortSignal.timeout(20_000),
        });
        if (detailResponse.ok) {
          const detailHtml = await detailResponse.text();
          const detail = load(detailHtml);
          const description = detail('.job_description, .job_listing .entry-content, article .entry-content, .entry-content').first();
          description.find('script, style, nav, form').remove();
          const blocks = description.find('h1, h2, h3, h4, h5, h6, p, li, blockquote').toArray();
          const descriptionText = blocks.length
            ? blocks.map((block) => {
              const element = detail(block);
              const text = element.text().replace(/\s+/g, ' ').trim();
              if (!text) return '';
              if (/^h[1-6]$/i.test(block.tagName)) return `## ${text}`;
              if (block.tagName.toLowerCase() === 'li') return `• ${text}`;
              return text;
            }).filter(Boolean).join('\n\n')
            : description.text().replace(/\s+/g, ' ').trim();
          if (descriptionText) job.description = descriptionText.slice(0, 30_000);
          const pageText = detail('body').text();
          const email = pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
          if (email) job.contactEmail = email;
          const location = detail('.location a, .location').first().text().trim();
          if (location) job.location = location;
          const company = detail('.company .name, .company strong, .company').first().text().trim();
          if (company) job.company = company;
          const deadlineText = pageText.match(/(?:closes?|closing date|application deadline)\s*:?\s*([^\n\r]{3,40})/i)?.[1]?.trim();
          if (deadlineText) {
            const deadline = new Date(deadlineText);
            if (!Number.isNaN(deadline.getTime())) job.deadline = deadline;
          }
          const employmentType = detail('.job-type, .employment-type').first().text().trim();
          if (employmentType) job.employmentType = employmentType;
        }
      } catch {
        // Keep the listing-card data if a detail page is unavailable.
      }
      await wait(750);
    }
    return jobs;
  }
}
