/**
 * Import Preview, Diagnostics, Unified Feedback, and Tool Entry UI.
 *
 * - Import preview table: per-item select, select all, confirm
 * - Diagnostics: view, clear, export
 * - Settings/import-export/diagnostics navigation entries
 * - Unified closable screen-reader toast
 * - Local icon missing, network download failure with manual retry
 *
 * Does NOT: show/export sensitive URL/rule data in diagnostics,
 *           use system notifications for in-page routine feedback
 */

import { useState } from 'react';
import { Button, Toast, StatusBadge } from '@ui/shared/components';
import type { ImportPreview, ImportSlotConflict, ImportSlotDecision, DiagnosticEntry } from '@shared/types';

// ─── Import Preview Component ────────────────────────────────────────────────

interface ImportPreviewProps {
  preview: ImportPreview;
  onCommit: (decisions: ImportSlotConflict[]) => Promise<void>;
  onCancel: () => void;
}

export function ImportPreviewTable({ preview, onCommit, onCancel }: ImportPreviewProps) {
  const [decisions, setDecisions] = useState<ImportSlotConflict[]>(preview.slotConflicts);
  const [committing, setCommitting] = useState(false);

  const handleDecision = (slotId: number, decision: ImportSlotDecision) => {
    setDecisions((prev) => prev.map((d) => d.slotId === slotId ? { ...d, decision } : d));
  };

  const handleSelectAll = (decision: ImportSlotDecision) => {
    setDecisions((prev) => prev.map((d) => ({ ...d, decision })));
  };

  const handleConfirm = async () => {
    setCommitting(true);
    try {
      await onCommit(decisions);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <section aria-label="Import preview" className="tbs-import-preview">
      <h2>Import Preview</h2>

      {/* Summary */}
      <p className="tbs-import-preview__summary" role="status">
        {preview.slotConflicts.length} conflicts, {preview.newSlots.length} new slots, {preview.rules.length} rules
      </p>

      {/* Conflict table */}
      {preview.slotConflicts.length > 0 && (
        <>
          <div className="tbs-import-preview__bulk-actions">
            <Button size="sm" variant="ghost" onClick={() => handleSelectAll('import')} aria-label="Select all imported">
              All Imported
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleSelectAll('existing')} aria-label="Select all existing">
              All Existing
            </Button>
          </div>

          <table role="table" aria-label="Slot conflicts">
            <thead>
              <tr>
                <th scope="col">Slot</th>
                <th scope="col">Existing</th>
                <th scope="col">Imported</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((conflict) => (
                <tr key={conflict.slotId}>
                  <td>{conflict.slotId}</td>
                  <td>{conflict.existing?.urlMatch.value ?? '—'}</td>
                  <td>{conflict.imported.urlMatch.value}</td>
                  <td>
                    <select
                      value={conflict.decision}
                      onChange={(e) => handleDecision(conflict.slotId, e.target.value as ImportSlotDecision)}
                      aria-label={`Decision for slot ${conflict.slotId}`}
                    >
                      <option value="import">Import</option>
                      <option value="existing">Keep Existing</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Actions */}
      <div className="tbs-import-preview__actions">
        <Button variant="primary" onClick={handleConfirm} loading={committing} aria-label="Confirm import">
          Confirm Import
        </Button>
        <Button variant="ghost" onClick={onCancel} aria-label="Cancel import">
          Cancel
        </Button>
      </div>
    </section>
  );
}

// ─── Diagnostics Component ───────────────────────────────────────────────────

interface DiagnosticsProps {
  entries: DiagnosticEntry[];
  onClear: () => Promise<void>;
  onExport: () => Promise<string>;
}

export function DiagnosticsPanel({ entries, onClear, onExport }: DiagnosticsProps) {
  const [exported, setExported] = useState(false);

  const handleExport = async () => {
    await onExport();
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  return (
    <section aria-label="Diagnostics" className="tbs-diagnostics">
      <h2>Diagnostics</h2>
      <p className="tbs-diagnostics__note">
        Logs contain only timestamps, error codes, browser type, and operation type. No URLs, titles, or rule content.
      </p>

      <div className="tbs-diagnostics__actions">
        <Button size="sm" variant="secondary" onClick={handleExport} aria-label="Export diagnostics">
          Export
        </Button>
        <Button size="sm" variant="danger" onClick={onClear} aria-label="Clear diagnostics">
          Clear All
        </Button>
      </div>

      {exported && <p role="status" className="tbs-diagnostics__exported">Diagnostics exported</p>}

      <table role="table" aria-label="Diagnostic entries">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Code</th>
            <th scope="col">Browser</th>
            <th scope="col">Operation</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => (
            <tr key={i}>
              <td>{entry.timestamp}</td>
              <td>
                <StatusBadge
                  status={entry.errorCode === 'SUCCESS' ? 'active' : 'error'}
                  label={entry.errorCode}
                />
              </td>
              <td>{entry.browserType}</td>
              <td>{entry.operationType}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={4}>No diagnostic entries</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

// ─── Icon Status Component ───────────────────────────────────────────────────

interface IconStatusProps {
  cached: boolean;
  downloadFailed: boolean;
  onRetry: () => void;
}

export function IconStatus({ cached, downloadFailed, onRetry }: IconStatusProps) {
  if (cached) {
    return <StatusBadge status="active" label="Cached" />;
  }

  if (downloadFailed) {
    return (
      <span className="tbs-icon-status">
        <StatusBadge status="error" label="Download failed" />
        <Button size="sm" variant="ghost" onClick={onRetry} aria-label="Retry icon download">
          Retry
        </Button>
      </span>
    );
  }

  return <StatusBadge status="pending" label="Not cached" />;
}

// ─── Unified Toast (screen-reader accessible) ────────────────────────────────

export interface UnifiedToastState {
  variant: 'success' | 'warning' | 'error' | 'info';
  message: string;
  action?: { label: string; onClick: () => void };
}

export function UnifiedToast({ state, onDismiss }: { state: UnifiedToastState | null; onDismiss: () => void }) {
  if (!state) return null;
  return (
    <div className="tbs-unified-toast" role="region" aria-label="Notifications">
      <Toast
        variant={state.variant}
        message={state.message}
        action={state.action}
        onDismiss={onDismiss}
        duration={5000}
      />
    </div>
  );
}
