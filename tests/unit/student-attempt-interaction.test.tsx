// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinalAttemptClient } from '@/app/module-attempts/[id]/FinalAttemptClient';
import type { StudentAttemptView } from '@/lib/db/moduleAttempts';

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
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

async function render(view = active): Promise<void> {
  await act(async () => root.render(<FinalAttemptClient initialView={view} />));
}

describe('final-only student attempt', () => {
  it('keeps an answer locally across refresh without an answer API write, then submits the full sheet once', async () => {
    const mockedFetch = vi.mocked(fetch);
    await render();
    await act(async () => (container.querySelector('input[type="radio"]') as HTMLInputElement).click());
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`faculty-answers:${id}`)).toContain('"1":0');

    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect((container.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(true);
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({
      status: 'submitted', id, title: 'Timed mock', attemptNumber: 1,
      submittedAt: '2026-09-18T08:02:00.000Z', score: 4, maxPoints: 4,
      correctCount: 1, wrongCount: 0, unansweredCount: 0, review: null,
    }) } as Response);
    await act(async () => {
      (Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Submit attempt')!).click();
      await Promise.resolve();
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(`/api/module-attempts/${id}/submit`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ answers: [{ position: 1, selectedIndex: 0 }] }),
    }));
    expect(sessionStorage.getItem(`faculty-answers:${id}`)).toBeNull();
  });

  it('automatically submits the final sheet at the displayed deadline', async () => {
    const mockedFetch = vi.mocked(fetch);
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({
      status: 'submitted', id, title: 'Timed mock', attemptNumber: 1,
      submittedAt: active.deadlineAt, score: 0, maxPoints: 4,
      correctCount: 0, wrongCount: 0, unansweredCount: 1, review: null,
    }) } as Response);
    await render({ ...active, serverNow: active.deadlineAt });
    expect(mockedFetch).toHaveBeenCalledWith(`/api/module-attempts/${id}/submit`, expect.objectContaining({
      body: JSON.stringify({ answers: [] }),
    }));
  });
});
