import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';

const app = buildApp();

describe('health endpoint', () => {
  it('returns an ok status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('job feedback validation', () => {
  it('rejects malformed job ids before accessing the database', async () => {
    const response = await app.inject({ method: 'PUT', url: '/jobs/not-a-uuid/feedback', headers: { authorization: `Bearer ${config.AUTH_TOKEN ?? ''}` }, payload: { rating: 'relevant' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid job id or feedback rating' });
  });

  it('rejects unsupported feedback ratings', async () => {
    const response = await app.inject({ method: 'PUT', url: '/jobs/8f4fbb58-d3ab-4e9f-a84f-3a8cd78ca1c4/feedback', headers: { authorization: `Bearer ${config.AUTH_TOKEN ?? ''}` }, payload: { rating: 'maybe' } });
    expect(response.statusCode).toBe(400);
  });
});

describe('document deletion validation', () => {
  it('rejects malformed document ids before accessing the database', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/documents/not-a-uuid', headers: { authorization: `Bearer ${config.AUTH_TOKEN ?? ''}` } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Invalid document id' });
  });
});

afterAll(async () => app.close());
