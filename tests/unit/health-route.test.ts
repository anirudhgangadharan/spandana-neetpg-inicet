import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ corpus: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ corpusStatus: mocks.corpus }));
vi.mock('@/lib/db/userClient', () => ({ sql: { query: mocks.query } }));

import { GET } from '@/app/api/health/route';

beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({ DATABASE_URL: 'postgres://db/test', AUTH_SECRET: 'a'.repeat(32),
    AUTH_URL: 'https://example.org', AUTH_GOOGLE_ID: 'google-id', AUTH_GOOGLE_SECRET: 'google-secret',
    SUPER_ADMIN_GOOGLE_SUB: 'subject', ATTEMPT_SWEEP_SECRET: 'b'.repeat(32), PRIVACY_OPERATOR_NAME: 'Example Operator',
    PRIVACY_CONTACT_EMAIL: 'privacy@example.org' })) vi.stubEnv(key, value);
  mocks.corpus.mockReturnValue({ ready: true, reason: null, problems: [], manifest: null,
    integrity: { ok: true, rowCount: 1, problems: [] } });
  mocks.query.mockResolvedValueOnce([{ users_present: true, migrations_present: true }]).mockResolvedValueOnce([{ '?column?': 1 }]);
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('operational readiness endpoint', () => {
  it('requires corpus integrity, database schema, and runtime secrets', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ready: true, database: { ready: true }, configuration: { ready: true } });
  });

  it('fails closed without exposing a database exception', async () => {
    mocks.query.mockReset();
    mocks.query.mockRejectedValue(new Error('postgres://secret-user:secret-password@private-host/db'));
    const response = await GET();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('user database or migrations unavailable');
    expect(text).not.toContain('secret-password');
  });
});
