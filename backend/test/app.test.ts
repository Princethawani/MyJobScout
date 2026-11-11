import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const app = buildApp();

describe('health endpoint', () => {
  it('returns an ok status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

afterAll(async () => app.close());
