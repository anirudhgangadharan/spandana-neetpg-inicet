'use client';

/**
 * Global keyboard shortcuts (§8 P0):
 *   1–4  select an option        Enter  submit, then advance
 *   ←/→  previous / next          B     bookmark
 *   S    skip                     ?     shortcuts overlay
 *
 * Shortcuts are suppressed while focus is in a text field, so typing in the
 * search box never triggers navigation. ArrowUp/ArrowDown are deliberately NOT
 * bound here: they belong to the option radiogroup (see A11Y.md).
 */

import { useEffect } from 'react';
import type { AnswerIndex } from '@/types';

export interface ShortcutHandlers {
  readonly onSelect: (index: AnswerIndex) => void;
  readonly onSubmitOrAdvance: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onSkip: () => void;
  readonly onToggleBookmark: () => void;
  readonly onToggleHelp: () => void;
  readonly enabled: boolean;
}

const OPTION_KEYS: Readonly<Record<string, AnswerIndex>> = { '1': 0, '2': 1, '3': 2, '4': 3 };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const {
    onSelect,
    onSubmitOrAdvance,
    onNext,
    onPrevious,
    onSkip,
    onToggleBookmark,
    onToggleHelp,
    enabled,
  } = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const optionIndex = OPTION_KEYS[event.key];
      if (optionIndex !== undefined) {
        event.preventDefault();
        onSelect(optionIndex);
        return;
      }

      switch (event.key) {
        case 'Enter':
          // The radiogroup handles Enter when an option has focus; this is the
          // fallback for when focus is anywhere else on the page.
          if ((event.target as HTMLElement | null)?.getAttribute('role') === 'radio') return;
          event.preventDefault();
          onSubmitOrAdvance();
          break;
        case 'ArrowRight':
          event.preventDefault();
          onNext();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          onPrevious();
          break;
        case 's':
        case 'S':
          event.preventDefault();
          onSkip();
          break;
        case 'b':
        case 'B':
          event.preventDefault();
          onToggleBookmark();
          break;
        case '?':
          event.preventDefault();
          onToggleHelp();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onSelect, onSubmitOrAdvance, onNext, onPrevious, onSkip, onToggleBookmark, onToggleHelp]);
}

export const SHORTCUT_HELP: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: '1 – 4', action: 'Select option A – D' },
  { keys: 'Enter', action: 'Submit answer, then move to the next question' },
  { keys: '↑ / ↓', action: 'Move between options' },
  { keys: '← / →', action: 'Previous / next question' },
  { keys: 'S', action: 'Skip this question' },
  { keys: 'B', action: 'Bookmark this question' },
  { keys: '?', action: 'Show or hide this list' },
];
