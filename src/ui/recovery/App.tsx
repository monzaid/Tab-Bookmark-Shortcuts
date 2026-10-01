/**
 * Recovery Window — small independent window with the "Tab Not Found" actions.
 *
 * DT8④ buttons: Open URL (exact targets only), Switch to Previous/Next Match,
 * Do Nothing. Browsing (Prev/Next) NEVER closes the window (DT3); a
 * privileged-page failure surfaces inline via the existing errorCode path
 * (BLK-B / B2 — no SwitchOutcome variant is involved).
 *
 * Does NOT: put recovery in notification buttons or the toolbar popup.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@ui/shared/components';

export type RecoveryMatchType = 'exact' | 'regex';

/**
 * FIX-2: parse the `autoBind` URL param the worker now always sends.
 * The effective value is serialized as the literal `'true'` / `'false'`; a
 * missing param degrades to the global default (ON, DT8).
 */
export function parseAutoBindParam(raw: string | null): boolean {
  return raw !== 'false';
}

interface RecoveryWindowProps {
  recoveryId: string;
  slotTitle: string;
  slotUrl: string;
  /** Match type drives whether "Open URL" is shown (exact only, design §3.5). */
  matchType?: RecoveryMatchType;
  /** Effective auto-bind value for this slot; toggling persists it (A12/DT8④). */
  autoBind?: boolean;
  onOpenUrl: (recoveryId: string, autoBind: boolean) => Promise<void>;
  onNextMatch: (recoveryId: string, autoBind: boolean) => Promise<void>;
  onPrevMatch: (recoveryId: string, autoBind: boolean) => Promise<void>;
  onAutoBindChange?: (autoBind: boolean) => void;
  onDismiss: (recoveryId: string) => Promise<void>;
}

export function RecoveryWindow({
  recoveryId,
  slotTitle,
  slotUrl,
  matchType = 'exact',
  // FIX-2: default to the global default (ON, DT8) instead of always-off, so a
  // caller that omits the prop still opens the checkbox in the right state.
  autoBind = true,
  onOpenUrl,
  onNextMatch,
  onPrevMatch,
  onAutoBindChange,
  onDismiss,
}: RecoveryWindowProps) {
  const [status, setStatus] = useState<'active' | 'expired' | 'loading'>('active');
  const [error, setError] = useState<string | null>(null);
  const [autoBindChecked, setAutoBindChecked] = useState(autoBind);

  // Auto-expire after 5 minutes.
  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus('expired');
      void onDismiss(recoveryId);
    }, 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [recoveryId, onDismiss]);

  const handleOpenUrl = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      await onOpenUrl(recoveryId, autoBindChecked);
      setStatus('active');
    } catch (err) {
      // BLK-B / B2: a privileged page arrives as an errorCode from the worker;
      // surface the design copy inline rather than closing the window.
      const message = err instanceof Error && err.message === 'PROTECTED_PAGE'
        ? 'This URL cannot be opened'
        : 'Failed to open URL';
      setError(message);
      setStatus('active');
    }
  }, [recoveryId, autoBindChecked, onOpenUrl]);

  const handleNextMatch = useCallback(async () => {
    // Browsing is a repeatable action: it must NOT lock the buttons, so the
    // user can click again while it resolves (DT1/DT3).
    setError(null);
    try {
      await onNextMatch(recoveryId, autoBindChecked);
    } catch {
      setError('No matching tabs found at this time');
    }
  }, [recoveryId, autoBindChecked, onNextMatch]);

  const handlePrevMatch = useCallback(async () => {
    setError(null);
    try {
      await onPrevMatch(recoveryId, autoBindChecked);
    } catch {
      setError('No matching tabs found at this time');
    }
  }, [recoveryId, autoBindChecked, onPrevMatch]);

  const handleAutoBindToggle = useCallback((next: boolean) => {
    setAutoBindChecked(next);
    onAutoBindChange?.(next);
  }, [onAutoBindChange]);

  const handleDismiss = useCallback(async () => {
    await onDismiss(recoveryId);
  }, [recoveryId, onDismiss]);

  if (status === 'expired') {
    return (
      <div role="dialog" aria-label="Tab recovery expired" className="tbs-recovery tbs-recovery--expired">
        <p>This recovery session has expired.</p>
        <Button size="sm" variant="ghost" onClick={handleDismiss}>Close</Button>
      </div>
    );
  }

  return (
    <div role="dialog" aria-label="Tab recovery" className="tbs-recovery">
      <h2 className="tbs-recovery__title">Tab Not Found</h2>
      <p className="tbs-recovery__info">
        The tab for <strong>{slotTitle}</strong> is no longer available.
      </p>
      <p className="tbs-recovery__url" title={slotUrl}>{slotUrl}</p>

      <label className="tbs-recovery__autobind">
        <input
          type="checkbox"
          checked={autoBindChecked}
          onChange={(e) => { handleAutoBindToggle(e.target.checked); }}
        />
        <span>Auto-bind to this slot</span>
      </label>

      {error && <p role="alert" className="tbs-recovery__error">{error}</p>}

      <div className="tbs-recovery__actions">
        {matchType === 'exact' && (
          <Button variant="primary" onClick={handleOpenUrl} disabled={status === 'loading'} aria-label="Open saved URL in new tab">
            Open URL
          </Button>
        )}
        <Button variant="secondary" onClick={() => { void handlePrevMatch(); }} disabled={status === 'loading'} aria-label="Switch to previous matching tab">
          Switch to Previous Match
        </Button>
        <Button variant="secondary" onClick={handleNextMatch} disabled={status === 'loading'} aria-label="Switch to next matching tab">
          Switch to Next Match
        </Button>
        <Button variant="ghost" onClick={handleDismiss} aria-label="Do nothing and close">
          Do Nothing
        </Button>
      </div>
    </div>
  );
}