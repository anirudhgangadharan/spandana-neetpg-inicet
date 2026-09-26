import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/userClient', () => ({ sql: { query: mocks.query } }));

import { getCurrentActor } from '@/lib/auth/roles';

const verifiedFacultyRow = {
  email: 'professor@example.org',
  subject: 'google-subject-123',
  verified_email: 'professor@example.org',
  faculty_active: true,
  notes_granted: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env['SUPER_ADMIN_GOOGLE_SUB'];
  delete process.env['ADMIN_EMAILS'];
});

describe('live role resolution', () => {
  it('does not elevate a password account that uses an approved email', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', loginProvider: 'credentials' } });
    mocks.query.mockResolvedValue([verifiedFacultyRow]);
    expect((await getCurrentActor())?.role).toBe('student');
  });

  it('grants faculty only while the verified Google grant is active', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', loginProvider: 'google' } });
    mocks.query.mockResolvedValueOnce([verifiedFacultyRow]).mockResolvedValueOnce([
      { ...verifiedFacultyRow, faculty_active: false },
    ]);
    expect((await getCurrentActor())?.role).toBe('faculty');
    expect((await getCurrentActor())?.role).toBe('student');
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('recognizes only the configured verified Google subject as super admin', async () => {
    process.env['SUPER_ADMIN_GOOGLE_SUB'] = 'google-subject-123';
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', loginProvider: 'google' } });
    mocks.query.mockResolvedValue([{ ...verifiedFacultyRow, faculty_active: false }]);
    expect((await getCurrentActor())?.role).toBe('super_admin');
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', loginProvider: 'credentials' } });
    expect((await getCurrentActor())?.role).toBe('student');
  });

  it('preserves editorial-note access only after Google identity verification', async () => {
    process.env['ADMIN_EMAILS'] = 'professor@example.org';
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', loginProvider: 'google' } });
    mocks.query.mockResolvedValueOnce([verifiedFacultyRow]).mockResolvedValueOnce([
      { ...verifiedFacultyRow, subject: null, verified_email: null },
    ]);
    expect((await getCurrentActor())?.canEditNotes).toBe(true);
    expect((await getCurrentActor())?.canEditNotes).toBe(false);
  });
});
