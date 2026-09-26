import { describe, expect, it } from 'vitest';
import { attachSessionIdentity } from '@/auth.config';

describe('edge-safe auth session identity', () => {
  it('copies the signed JWT subject used by per-student exam rate limits', () => {
    const session = attachSessionIdentity({
      expires: '2030-01-01T00:00:00.000Z',
      user: { id: '', name: 'Student', email: 'student@example.org', image: null },
    }, { id: 'student-db-id', loginProvider: 'google' });
    expect(session.user.id).toBe('student-db-id');
    expect(session.user.loginProvider).toBe('google');
  });

  it('does not invent an identity for an older or malformed token', () => {
    const session = attachSessionIdentity({
      expires: '2030-01-01T00:00:00.000Z',
      user: { id: '', name: null, email: null, image: null },
    }, {});
    expect(session.user.id).toBe('');
    expect(session.user.loginProvider).toBeUndefined();
  });
});
