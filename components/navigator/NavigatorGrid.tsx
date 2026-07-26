'use client';

/**
 * Virtualised question navigator (§8 P0, §11).
 *
 * Colour coding: unseen neutral, current accent, correct green, incorrect red,
 * skipped struck through, bookmarked an amber RING so it composes with the fill
 * rather than replacing it.
 *
 * Virtualised by row with `@tanstack/react-virtual`, so a 500-question exam
 * renders about a dozen rows rather than 500 cells.
 */

import { useEffect, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AttemptRecord } from '@/types';
import styles from './navigator.module.css';

const CELL = 44;
const GAP = 8;
const ROW_HEIGHT = CELL + GAP;

export interface NavigatorGridProps {
  readonly ids: readonly string[];
  readonly index: number;
  readonly attempts: ReadonlyMap<string, AttemptRecord>;
  readonly bookmarks: ReadonlySet<string>;
  readonly revealed: ReadonlySet<string>;
  readonly onJump: (index: number) => void;
}

/**
 * Column count from the measured width. The scroll element is held in state
 * rather than a ref so the effect re-runs when it mounts — reading `ref.current`
 * during render would be a tearing hazard under concurrent rendering.
 */
function useColumnCount(element: HTMLDivElement | null): number {
  const [columns, setColumns] = useState(8);

  useEffect(() => {
    if (element === null) return;
    const measure = (): void => {
      const width = element.clientWidth;
      if (width <= 0) return;
      setColumns(Math.max(4, Math.floor((width + GAP) / ROW_HEIGHT)));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // A ResizeObserver on the scroller alone proved unreliable when the whole
    // layout reflows from two columns to one: the grid kept a stale column count
    // and overflowed its scroller. The window listener is the backstop.
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [element]);

  return columns;
}

export function NavigatorGrid({
  ids,
  index,
  attempts,
  bookmarks,
  revealed,
  onJump,
}: NavigatorGridProps): React.JSX.Element {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const columns = useColumnCount(scrollEl);
  const rowCount = Math.ceil(ids.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  // Keep the active question in view when navigation happens by keyboard.
  useEffect(() => {
    if (columns > 0) virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' });
    // `virtualizer` is stable for a given scroll element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, columns]);

  const template = useMemo(() => `repeat(${columns}, minmax(${CELL}px, 1fr))`, [columns]);

  return (
    <div className={styles.wrapper}>
      <div ref={setScrollEl} className={styles.scroller}>
        <div className={styles.rows} style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((row) => {
            const start = row.index * columns;
            const slice = ids.slice(start, start + columns);
            return (
              <div
                key={row.key}
                className={styles.row}
                style={{ transform: `translateY(${row.start}px)`, height: `${CELL}px`, gridTemplateColumns: template }}
              >
                {slice.map((id, offset) => {
                  const position = start + offset;
                  const attempt = attempts.get(id);
                  const isRevealed = revealed.has(id);
                  const classes = [styles.cell];

                  // A verdict is only shown once it has been revealed to the
                  // user: in exam mode the navigator must not leak correctness
                  // before the paper is submitted.
                  if (isRevealed && attempt !== undefined) {
                    if (attempt.verdict === 'correct') classes.push(styles.cellCorrect);
                    else if (attempt.verdict === 'incorrect') classes.push(styles.cellIncorrect);
                    else if (attempt.verdict === 'skipped') classes.push(styles.cellSkipped);
                  } else if (attempt?.verdict === 'skipped') {
                    classes.push(styles.cellSkipped);
                  }
                  if (bookmarks.has(id)) classes.push(styles.cellBookmarked);
                  if (position === index) classes.push(styles.cellCurrent);

                  const status =
                    position === index
                      ? 'current'
                      : attempt === undefined
                        ? 'not attempted'
                        : isRevealed
                          ? attempt.verdict
                          : 'answered';

                  return (
                    <button
                      key={id}
                      type="button"
                      className={classes.join(' ')}
                      aria-label={`Question ${position + 1}, ${status}${bookmarks.has(id) ? ', bookmarked' : ''}`}
                      aria-current={position === index ? 'true' : undefined}
                      onClick={() => onJump(position)}
                    >
                      {position + 1}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <ul className={styles.legend} aria-label="Navigator legend">
        <li className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--correct-soft)', borderColor: 'var(--correct-border)' }} />
          Correct
        </li>
        <li className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--incorrect-soft)', borderColor: 'var(--incorrect-border)' }} />
          Incorrect
        </li>
        <li className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'var(--surface-sunken)' }} />
          Unseen
        </li>
        <li className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: 'transparent', borderColor: 'var(--bookmark-ring)', borderWidth: 2 }} />
          Bookmarked
        </li>
      </ul>
    </div>
  );
}
