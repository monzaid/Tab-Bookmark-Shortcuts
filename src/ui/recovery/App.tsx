/**
 * Recovery Window — small independent window with three actions.
 *
 * - Open URL
 * - Switch to next matching tab (real-time re-query)
 * - Do nothing (dismiss)
 * - Close/timeout states
 *
 * Does NOT: put recovery in notification buttons or toolbar popup
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@ui/shared/components';

interface RecoveryWindowProps {
  recoveryId: string;
  slotTitle: string;
  slotUrl: string;
  onOpenUrl: (recoveryId: string) => Promise<void>;
  onNextMatch: (recoveryId: string) => Promise<void>;
  onDismiss: (recoveryId: string) => Promise<void>;
}

export function RecoveryWindow({
  recoveryId,
  slotTitle,
  slotUrl,
  onOpenUrl,
  onNextMatch,
  onDismiss,
}: RecoveryWindowProps) {
  const [status, setStatus] = useState<'active' | 'expired' | 'loading'>('active');
  const [error, setError] = useState<string | null>(null);

  // Auto-expire after 5 minutes
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
      await onOpenUrl(recoveryId);
    } catch {
      setError('Failed to open URL');
      setStatus('active');
    }
  }, [recoveryId, onOpenUrl]);

  const handleNextMatch = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      await onNextMatch(recoveryId);
    } catch {
      setError('No matching tabs found');
      setStatus('active');
    }
  }, [recoveryId, onNextMatch]);

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

      {error && <p role="alert" className="tbs-recovery__error">{error}</p>}

      <div className="tbs-recovery__actions">
        <Button variant="primary" onClick={handleOpenUrl} disabled={status === 'loading'} aria-label="Open saved URL in new tab">
          Open URL
        </Button>
        <Button variant="secondary" onClick={handleNextMatch} disabled={status === 'loading'} aria-label="Switch to next matching tab">
          Next Match
        </Button>
        <Button variant="ghost" onClick={handleDismiss} aria-label="Do nothing and close">
          Do Nothing
        </Button>
      </div>
    </div>
  );
}
