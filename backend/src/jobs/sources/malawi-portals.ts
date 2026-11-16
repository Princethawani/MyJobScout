import { load } from 'cheerio';
import type { Job, JobSource } from '../types.js';

type Portal = {
  name: string;
  baseUrl: string;
  listingUrl: string;
  pathPattern: RegExp;
  cardSelector: string;
  excludeText?: RegExp;
};

const portals: Portal[] = [
  {
    name: 'Ntchito Malawi', baseUrl: 'https://ntchito.com', listingUrl: 'https://ntchito.com/',
    pathPattern: /\/job\/[^/?#]+/, cardSelector: 'article, .job_listing, li', excludeText: /tender|request for proposals|grant|scholarship|supply and delivery|invitation to bid|consultancy/i,
  },
  {
    name: 'Careers Malawi', baseUrl: 'https://careersmw.com', listingUrl: 'https://careersmw.com/?post_type=job_listing',
    pathPattern: /\/job\//, cardSelector: 'article, .job_listing, li',
  },
  {
    name: 'CareerAd Malawi', baseUrl: 'https://careeradmw.com', listingUrl: 'https://careeradmw.com/jobs',
    pathPattern: /\/jobs\/[^/?#]+/, cardSelector: 'article, .job-card, .job-listing, li', excludeText: /cv and cover letter writing service|advertised opportunity/i,
  },
  {
    name: 'Online Job Vacancies in Malawi', baseUrl: 'https://onlinejobmw.com', listingUrl: 'https://onlinejobmw.com/job-vacancies/',
    pathPattern: /\/vacancies\/[^/?#]+/, cardSelector: 'article, .job_listing, .post, li', excludeText: /tender|consultancy|training|education|classified|announcement/i,
  },
];

class MalawiPortalSource implements JobSource {
  readonly name: string;
  readonly baseUrl: string;
  private readonly portal: Portal;

  constructor(portal: Portal) {
    this.portal = portal;
    this.name = portal.name;
    this.baseUrl = portal.baseUrl;
  }

  async fetchJobs(): Promise<Job[]> {
    const response = await fetch(this.portal.listingUrl, {
      headers: { 'user-agent': 'MyJobScout/0.1 (personal job-search aggregator)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`${this.name} returned HTTP ${response.status}`);

    const $ = load(await response.text());
    const found = new Map<string, Job>();
    $('a[href]').each((_, element) => {
      const anchor = $(element);
      const rawUrl = anchor.attr('href');
      if (!rawUrl || !this.portal.pathPattern.test(rawUrl)) return;
      const url = new URL(rawUrl, this.baseUrl).href.split('#')[0];
      if (found.has(url)) return;
      const card = anchor.closest(this.portal.cardSelector);
      const context = card.length ? card : anchor.parent();
      const title = (context.find('h1,h2,h3,h4').first().text() || anchor.text()).replace(/\s+/g, ' ').trim();
      const cardText = context.text().replace(/\s+/g, ' ').trim();
      if (!title || title.length > 220 || this.portal.excludeText?.test(cardText)) return;
      const dateText = context.find('time').first().attr('datetime');
      const postedAt = dateText && !Number.isNaN(Date.parse(dateText)) ? new Date(dateText) : undefined;
      const company = context.find('.company, .employer, [class*=company]').first().text().replace(/\s+/g, ' ').trim();
      const location = context.find('.location, [class*=location]').first().text().replace(/\s+/g, ' ').trim();
      const type = context.find('.job-type, [class*=type]').first().text().replace(/\s+/g, ' ').trim();
      found.set(url, { url, title, company: company || undefined, location: location || undefined, employmentType: type || undefined, postedAt });
    });
    return [...found.values()].slice(0, 100);
  }
}

export const malawiPortalSources: JobSource[] = portals.map((portal) => new MalawiPortalSource(portal));
