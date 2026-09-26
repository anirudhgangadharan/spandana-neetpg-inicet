// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttemptClient } from '@/app/module-attempts/[id]/AttemptClient';
import type { StudentAttemptView } from '@/lib/db/moduleAttempts';

vi.mock('next/link', () => ({ default: ({ href, children }: {
  href: string; children: React.ReactNode;
}) => <a href={href}>{children}</a> }));

const id = '1de98e87-5a44-4d58-9a42-85ff6418c89b';
const active: StudentAttemptView = {
  status: 'active', id, title: 'Timed mock', attemptNumber: 1,
  startedAt: '2026-09-18T08:00:00.000Z', deadlineAt: '2026-09-18T08:10:00.000Z',
  serverNow: '2026-09-18T08:01:00.000Z', responses: [],
  questions: [{ position: 1, id: 'question-1', source: 'medmcqa', stem: 'Question stem',
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'], subject: 'Medicine', topic: null }],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

async function render(view = active): Promise<void> {
  await act(async () => root.render(<AttemptClient initialView={view} studentId="student-1" />));
}

describe('student attempt interaction', () => {
  it('retains an unsent choice through refresh and sends it after reconnection', async () => {
    const mockedFetch = vi.mocked(fetch);
    mockedFetch.mockRejectedValueOnce(new TypeError('Network unavailable'));
    await render();
    await act(async () => {
      (container.querySelector('input[type="radio"]') as HTMLInputElement).click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('1 unsaved answer');
    expect(sessionStorage.getItem(`faculty-unsent:student-1:${id}`)).toContain('[1,0]');

    await act(async () => root.unmount());
    root = createRoot(container);
    mockedFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ position: 1, selectedIndex: 0, revision: 1, activeTimeMs: null,
        savedAt: '2026-09-18T08:01:01.000Z' }),
    } as Response);
    await render();
    expect((container.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(true);
    expect(container.textContent).toContain('All answers saved.');
    expect(sessionStorage.getItem(`faculty-unsent:student-1:${id}`)).toBeNull();
    expect(mockedFetch).toHaveBeenCalledWith(`/api/module-attempts/${id}/responses`, expect.objectContaining({ method: 'PUT' }));
  });

  it('requests server finalization when the displayed deadline is reached', async () => {
    const mockedFetch = vi.mocked(fetch);
    mockedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({
      status: 'expired', id, title: 'Timed mock', attemptNumber: 1,
      submittedAt: '2026-09-18T08:10:00.000Z', score: 0, maxPoints: 4,
      correctCount: 0, wrongCount: 0, unansweredCount: 1, review: null,
    }) } as Response);
    await render({ ...active, serverNow: active.deadlineAt });
    expect(container.textContent).toContain('Time ended');
    expect(container.textContent).toContain('0 / 4 points');
    expect(mockedFetch).toHaveBeenCalledWith(`/api/module-attempts/${id}`, expect.objectContaining({ cache: 'no-store' }));
  });
});
