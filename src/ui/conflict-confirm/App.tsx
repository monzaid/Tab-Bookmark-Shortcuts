/**
 * Conflict Confirm Window — shown when saving to an occupied slot via shortcut.
 *
 * - Displays old binding summary vs new tab summary
 * - Three options: Cancel (undo), Force Overwrite, 5s countdown auto-overwrite
 * - Progress bar: 5s linear shrink animation via CSS @keyframes
 * - 5s no action → auto-execute overwrite and close window
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@ui/shared/components';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConflictInfo {
  slotId: number;
  oldTitle: string;
  oldUrl: string;
  newTitle: string;
  newUrl: string;
}

export interface ConflictConfirmProps {
  conflict: ConflictInfo;
  onOverwrite: () => Promise<void>;
  onCancel: () => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConflictConfirm({ conflict, onOverwrite, onCancel }: ConflictConfirmProps) {
  const [status, setStatus] = useState<'active' | 'overwriting' | 'cancelled'>('active');
  const [countdown, setCountdown] = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoTriggered = useRef(false);

  // 5-second countdown → auto overwrite
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (!autoTriggered.current) {
            autoTriggered.current = true;
            void handleOverwrite();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOverwrite = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setStatus('overwriting');
    try {
      await onOverwrite();
    } finally {
      window.close();
    }
  }, [onOverwrite]);

  const handleCancel = useCallback(async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setStatus('cancelled');
    try {
      await onCancel();
    } finally {
      window.close();
    }
  }, [onCancel]);

  if (status === 'cancelled') {
    return (
      <div className="tbs-conflict" role="dialog" aria-label="Save cancelled">
        <div className="tbs-conflict__card">
          <p className="tbs-conflict__status">Save cancelled.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tbs-conflict" role="dialog" aria-label="Slot conflict confirmation" aria-modal="true">
      <div className="tbs-conflict__card">
        <h2 className="tbs-conflict__title">Slot {conflict.slotId} Occupied</h2>

        {/* Old binding summary */}
        <div className="tbs-conflict__summary tbs-conflict__summary--old">
          <span className="tbs-conflict__summary-label">Current:</span>
          <span className="tbs-conflict__summary-title" title={conflict.oldTitle}>
            {conflict.oldTitle || 'Unknown page'}
          </span>
          <span className="tbs-conflict__summary-url" title={conflict.oldUrl}>
            {conflict.oldUrl}
          </span>
        </div>

        {/* New tab summary */}
        <div className="tbs-conflict__summary tbs-conflict__summary--new">
          <span className="tbs-conflict__summary-label">New:</span>
          <span className="tbs-conflict__summary-title" title={conflict.newTitle}>
            {conflict.newTitle || 'Unknown page'}
          </span>
          <span className="tbs-conflict__summary-url" title={conflict.newUrl}>
            {conflict.newUrl}
          </span>
        </div>

        {/* Progress bar: 5s countdown */}
        <div className="tbs-conflict__progress" role="progressbar" aria-valuenow={countdown} aria-valuemin={0} aria-valuemax={5} aria-label="Auto-overwrite countdown">
          <div
            className="tbs-conflict__progress-bar"
            style={{ animationDuration: '5s' }}
          />
        </div>
        <p className="tbs-conflict__countdown">
          Auto-overwrite in {countdown}s
        </p>

        {/* Actions */}
        <div className="tbs-conflict__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={status === 'overwriting'}
            aria-label="Cancel save"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleOverwrite}
            disabled={status === 'overwriting'}
            aria-label="Force overwrite slot"
          >
            {status === 'overwriting' ? 'Overwriting...' : 'Overwrite'}
          </Button>
        </div>
      </div>
    </div>
  );
}
