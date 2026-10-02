/**
 * EmptyState — a presentational four-variant empty/error panel (IMP-10).
 *
 * Deliberately ZERO decision logic: whether a section is `empty`, `no-match`,
 * `error-first` or `error-stale` is decided by the section that owns the data,
 * never by this component. It only renders the variant it is told to render.
 */

import { Button } from './components';

export type EmptyStateVariant = 'empty' | 'no-match' | 'error-first' | 'error-stale';

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** Optional action button (e.g. "Clear search"). */
  action?: { label: string; onClick: () => void };
  /** Override the variant's default message. */
  message?: string;
}

const DEFAULTS: Record<EmptyStateVariant, string> = {
  empty: 'Nothing here yet.',
  'no-match': 'No rules match your search.',
  'error-first': 'Could not load your data. Please try again.',
  'error-stale': 'Could not refresh. Showing the last loaded data.',
};

export function EmptyState({ variant, action, message }: EmptyStateProps) {
  const text = message ?? DEFAULTS[variant];
  // Only a first-load failure is assertive; the "stale" variant is a status.
  const isError = variant === 'error-first';

  return (
    <div
      className={`tbs-empty-state tbs-empty-state--${variant}`}
      role={isError ? 'alert' : 'status'}
    >
      <p className="tbs-empty-state__message">{text}</p>
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}