'use client';

import styles from './ui.module.css';

export interface BadgeProps {
  readonly children: React.ReactNode;
  readonly tone?: 'neutral' | 'accent' | 'warning';
  readonly title?: string;
}

export function Badge({ children, tone = 'neutral', title }: BadgeProps): React.JSX.Element {
  const cls =
    tone === 'accent'
      ? `${styles.badge} ${styles.badgeAccent}`
      : tone === 'warning'
        ? `${styles.badge} ${styles.badgeWarning}`
        : styles.badge;
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

/** `ComponentPropsWithRef` so callers can pass `ref` directly (React 19). */
export interface ButtonProps extends React.ComponentPropsWithRef<'button'> {
  readonly variant?: 'default' | 'primary' | 'ghost';
}

export function Button({ variant = 'default', className, ...rest }: ButtonProps): React.JSX.Element {
  const variantClass =
    variant === 'primary' ? styles.buttonPrimary : variant === 'ghost' ? styles.buttonGhost : '';
  return <button type="button" className={`${styles.button} ${variantClass} ${className ?? ''}`} {...rest} />;
}

export interface IconButtonProps extends React.ComponentPropsWithRef<'button'> {
  readonly active?: boolean;
  /** Required: an icon-only control must carry its own name (§10). */
  readonly label: string;
}

export function IconButton({ active = false, label, className, ...rest }: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`${styles.iconButton} ${active ? styles.iconButtonActive : ''} ${className ?? ''}`}
      {...rest}
    />
  );
}

export interface ProgressBarProps {
  readonly value: number;
  readonly max: number;
  readonly label: string;
}

export function ProgressBar({ value, max, label }: ProgressBarProps): React.JSX.Element {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      className={styles.progressTrack}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

export { styles as uiStyles };
