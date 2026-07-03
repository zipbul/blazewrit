import { describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { createRestApi, ALLOWED_ORIGINS } from './rest';

/**
 * Edge lockdown contract: CORS must be an allow-list (never '*') — any web page the user
 * visits must NOT be able to read the chat log or drive the agent cross-origin.
 * (The 127.0.0.1 bind lives in serve.ts and is asserted by inspection there.)
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');

const req = (origin?: string) =>
  new Request('http://localhost/api/projects', { headers: origin ? { origin } : {} });

describe('CORS allow-list', () => {
  it('never emits access-control-allow-origin: *', async () => {
    const app = createRestApi(sql, {});
    const res = await app.handle(req('https://evil.example'));
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('reflects only allow-listed origins (the local FE)', async () => {
    const app = createRestApi(sql, {});
    const ok = await app.handle(req('http://localhost:4200'));
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:4200');

    const bad = await app.handle(req('https://evil.example'));
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('exposes the allow-list for serve-time configuration', () => {
    expect(ALLOWED_ORIGINS).toContain('http://localhost:4200');
    expect(ALLOWED_ORIGINS).not.toContain('*');
  });
});
