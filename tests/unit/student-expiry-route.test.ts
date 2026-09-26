import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expire: vi.fn() }));
vi.mock('@/lib/db/moduleAttempts', () => ({ expireDueStudentAttempts: mocks.expire }));

import { POST } from '@/app/api/internal/module-attempts/expire/route';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ATTEMPT_SWEEP_SECRET', 'long-random-test-secret');
});

describe('scheduled attempt expiry route', () => {
  it('does no database work without the exact bearer secret', async () => {
    for (const authorization of [undefined, 'Bearer wrong-secret']) {
      const response = await POST(new Request('https://example.org/api/internal/module-attempts/expire', {
        method: 'POST', ...(authorization ? { headers: { authorization } } : {}),
      }));
      expect(response.status).toBe(404);
    }
    expect(mocks.expire).not.toHaveBeenCalled();
  });

  it('processes bounded batches and returns only a count', async () => {
    mocks.expire.mockResolvedValueOnce(25).mockResolvedValueOnce(3);
    const response = await POST(new Request('https://example.org/api/internal/module-attempts/expire', {
      method: 'POST', headers: { authorization: 'Bearer long-random-test-secret' },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ finalized: 28 });
    expect(mocks.expire).toHaveBeenCalledTimes(2);
    expect(mocks.expire).toHaveBeenCalledWith(25);
  });
});
