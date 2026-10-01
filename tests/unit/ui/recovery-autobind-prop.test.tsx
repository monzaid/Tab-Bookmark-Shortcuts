import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecoveryWindow, parseAutoBindParam } from '@ui/recovery/App';

/**
 * FIX-2: the auto-bind checkbox must open in the state passed by the worker
 * (`autoBind` URL param → prop), not always unchecked. Design §3.5 / DT8④.
 */
describe('FIX-2: recovery window auto-bind initial state', () => {
  const baseProps = {
    recoveryId: 'rec-1',
    slotTitle: 'Example',
    slotUrl: 'https://example.com',
    matchType: 'exact' as const,
    onOpenUrl: vi.fn().mockResolvedValue(undefined),
    onNextMatch: vi.fn().mockResolvedValue(undefined),
    onPrevMatch: vi.fn().mockResolvedValue(undefined),
    onDismiss: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FIX-2 RED ①: autoBind={true} → the checkbox is checked initially', () => {
    render(<RecoveryWindow {...baseProps} autoBind={true} />);
    expect(screen.getByRole('checkbox', { name: /Auto-bind to this slot/ })).toBeChecked();
  });

  it('FIX-2 RED ②: autoBind={false} → the checkbox is unchecked initially', () => {
    render(<RecoveryWindow {...baseProps} autoBind={false} />);
    expect(screen.getByRole('checkbox', { name: /Auto-bind to this slot/ })).not.toBeChecked();
  });

  it('FIX-2 RED ③: the default (no autoBind prop) is checked — global default is on (DT8)', () => {
    render(<RecoveryWindow {...baseProps} />);
    expect(screen.getByRole('checkbox', { name: /Auto-bind to this slot/ })).toBeChecked();
  });

  it('FIX-2: parseAutoBindParam follows the URL contract', () => {
    // The worker always sends the effective value as 'true'/'false'.
    expect(parseAutoBindParam('true')).toBe(true);
    expect(parseAutoBindParam('false')).toBe(false);
    // A missing param degrades to the global default (on).
    expect(parseAutoBindParam(null)).toBe(true);
  });
});