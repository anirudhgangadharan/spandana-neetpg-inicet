import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: vi.fn(), landing: vi.fn(), start: vi.fn(), attempt: vi.fn(), save: vi.fn(), activity: vi.fn(), submit: vi.fn(),
}));
vi.mock('@/lib/auth/roles', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/db/studentModules', () => ({ getStudentModuleLanding: mocks.landing }));
vi.mock('@/lib/db/moduleAttempts', () => ({
  StudentAttemptError: class extends Error {},
  startStudentAttempt: mocks.start, getStudentAttempt: mocks.attempt,
  saveStudentResponse: mocks.save, recordStudentActivity: mocks.activity, submitStudentAttempt: mocks.submit,
}));

import { GET as moduleGet } from '@/app/api/modules/[token]/route';
import { POST as attemptStart } from '@/app/api/modules/[token]/attempts/route';
import { GET as attemptGet } from '@/app/api/module-attempts/[id]/route';
import { PUT as responsePut } from '@/app/api/module-attempts/[id]/responses/route';
import { PUT as activityPut } from '@/app/api/module-attempts/[id]/activity/route';
import { POST as attemptSubmit } from '@/app/api/module-attempts/[id]/submit/route';

const token = '32ed02eb-f7ed-492c-9ee6-8bd47f6d910f';
const attemptId = '48c68e1a-d988-408e-9f06-734a0ec1703f';
const tokenContext = { params: Promise.resolve({ token }) };
const attemptContext = { params: Promise.resolve({ id: attemptId }) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ role: 'student', userId: 'student-1' });
});

describe('student module route boundaries', () => {
  it('does not query link or attempt data for a faculty or super-admin account', async () => {
    mocks.role.mockResolvedValue(null);
    expect((await moduleGet(new Request(`https://example.org/api/modules/${token}`), tokenContext)).status).toBe(404);
    expect((await attemptGet(new Request(`https://example.org/api/module-attempts/${attemptId}`), attemptContext)).status).toBe(404);
    expect(mocks.landing).not.toHaveBeenCalled();
    expect(mocks.attempt).not.toHaveBeenCalled();
  });

  it('rejects invalid link tokens without a database lookup', async () => {
    const response = await moduleGet(new Request('https://example.org/api/modules/bad'), {
      params: Promise.resolve({ token: 'bad' }),
    });
    expect(response.status).toBe(404);
    expect(mocks.landing).not.toHaveBeenCalled();
  });

  it('passes only the authenticated student identity to the module and attempt lookup', async () => {
    mocks.landing.mockResolvedValue({ state: 'closed' });
    mocks.attempt.mockResolvedValue({ status: 'submitted', score: 4, review: null });
    const landing = await moduleGet(new Request(`https://example.org/api/modules/${token}`), tokenContext);
    const attempt = await attemptGet(new Request(`https://example.org/api/module-attempts/${attemptId}`), attemptContext);
    expect(landing.status).toBe(200);
    expect(attempt.status).toBe(200);
    expect(mocks.landing).toHaveBeenCalledWith(token, 'student-1');
    expect(mocks.attempt).toHaveBeenCalledWith(attemptId, 'student-1');
    expect(landing.headers.get('cache-control')).toBe('no-store');
  });

  it('requires same-origin mutations and validates bounded answer input', async () => {
    const crossOrigin = new Request(`https://example.org/api/modules/${token}/attempts`, {
      method: 'POST', headers: { origin: 'https://elsewhere.example' },
    });
    expect((await attemptStart(crossOrigin, tokenContext)).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();

    const invalid = new Request(`https://example.org/api/module-attempts/${attemptId}/responses`, {
      method: 'PUT', headers: { origin: 'https://example.org', 'content-type': 'application/json' },
      body: JSON.stringify({ position: 1, selectedIndex: 4, expectedRevision: 0 }),
    });
    expect((await responsePut(invalid, attemptContext)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();

    const oversized = new Request(`https://example.org/api/module-attempts/${attemptId}/responses`, {
      method: 'PUT', headers: { origin: 'https://example.org' }, body: 'x'.repeat(2049),
    });
    expect((await responsePut(oversized, attemptContext)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('routes start, save and submit through server-owned attempt functions', async () => {
    mocks.start.mockResolvedValue({ id: attemptId, resumed: false });
    mocks.save.mockResolvedValue({ expired: false, response: { position: 1, selectedIndex: 2, revision: 1 } });
    mocks.activity.mockResolvedValue({ expired: false });
    mocks.submit.mockResolvedValue({ status: 'submitted', score: 4, review: null });
    const start = await attemptStart(new Request(`https://example.org/api/modules/${token}/attempts`, {
      method: 'POST', headers: { origin: 'https://example.org' },
    }), tokenContext);
    expect(start.status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith(token, 'student-1');

    const save = await responsePut(new Request(`https://example.org/api/module-attempts/${attemptId}/responses`, {
      method: 'PUT', headers: { origin: 'https://example.org' },
      body: JSON.stringify({ position: 1, selectedIndex: 2, expectedRevision: 0 }),
    }), attemptContext);
    expect(save.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith('student-1', attemptId, {
      position: 1, selectedIndex: 2, expectedRevision: 0,
    });

    const activity = await activityPut(new Request(`https://example.org/api/module-attempts/${attemptId}/activity`, {
      method: 'PUT', headers: { origin: 'https://example.org' }, body: JSON.stringify({ position: 2 }),
    }), attemptContext);
    expect(activity.status).toBe(200);
    expect(mocks.activity).toHaveBeenCalledWith('student-1', attemptId, 2);

    const forgedTime = await activityPut(new Request(`https://example.org/api/module-attempts/${attemptId}/activity`, {
      method: 'PUT', headers: { origin: 'https://example.org' }, body: JSON.stringify({ position: 2, elapsedMs: 999999 }),
    }), attemptContext);
    expect(forgedTime.status).toBe(400);

    const submit = await attemptSubmit(new Request(`https://example.org/api/module-attempts/${attemptId}/submit`, {
      method: 'POST', headers: { origin: 'https://example.org' },
    }), attemptContext);
    expect(submit.status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith(attemptId, 'student-1');
  });
});
