import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportPreviewTable, DiagnosticsPanel, IconStatus, UnifiedToast } from '@ui/import-preview/App';
import type { ImportPreview, DiagnosticEntry } from '@shared/types';

describe('T20: Import preview, diagnostics, unified feedback, tool entries', () => {
  const mockPreview: ImportPreview = {
    valid: true,
    slotConflicts: [
      { slotId: 1, existing: { id: 1, urlMatch: { type: 'exact', value: 'https://old.com' }, strategy: 'inherit', uiMarker: {}, titleSnapshot: 'Old', faviconSnapshot: '', createdAt: '', updatedAt: '' }, imported: { id: 1, urlMatch: { type: 'exact', value: 'https://new.com' }, strategy: 'inherit', uiMarker: {}, titleSnapshot: 'New', faviconSnapshot: '', createdAt: '', updatedAt: '' }, decision: 'import' },
      { slotId: 3, existing: { id: 3, urlMatch: { type: 'exact', value: 'https://keep.com' }, strategy: 'inherit', uiMarker: {}, titleSnapshot: 'Keep', faviconSnapshot: '', createdAt: '', updatedAt: '' }, imported: { id: 3, urlMatch: { type: 'exact', value: 'https://replace.com' }, strategy: 'inherit', uiMarker: {}, titleSnapshot: 'Replace', faviconSnapshot: '', createdAt: '', updatedAt: '' }, decision: 'import' },
    ],
    newSlots: [{ id: 5, urlMatch: { type: 'exact', value: 'https://brand-new.com' }, strategy: 'inherit', uiMarker: {}, titleSnapshot: 'New', faviconSnapshot: '', createdAt: '', updatedAt: '' }],
    rules: [],
    globalStrategy: 'B',
    configVersion: 3,
  };

  describe('Happy path — import preview and confirm', () => {
    it('should render conflict summary', () => {
      render(<ImportPreviewTable preview={mockPreview} onCommit={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByRole('status')).toHaveTextContent('2 conflicts, 1 new slots, 0 rules');
    });

    it('should render per-slot decision selects', () => {
      render(<ImportPreviewTable preview={mockPreview} onCommit={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByLabelText('Decision for slot 1')).toHaveValue('import');
      expect(screen.getByLabelText('Decision for slot 3')).toHaveValue('import');
    });

    it('should select all imported', () => {
      render(<ImportPreviewTable preview={mockPreview} onCommit={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Select all existing' }));
      expect(screen.getByLabelText('Decision for slot 1')).toHaveValue('existing');
      expect(screen.getByLabelText('Decision for slot 3')).toHaveValue('existing');
    });

    it('should call onCommit with decisions on confirm', async () => {
      const onCommit = vi.fn().mockResolvedValue(undefined);
      render(<ImportPreviewTable preview={mockPreview} onCommit={onCommit} onCancel={vi.fn()} />);

      // Change slot 3 to existing
      fireEvent.change(screen.getByLabelText('Decision for slot 3'), { target: { value: 'existing' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));

      expect(onCommit).toHaveBeenCalledWith([
        expect.objectContaining({ slotId: 1, decision: 'import' }),
        expect.objectContaining({ slotId: 3, decision: 'existing' }),
      ]);
    });

    it('should call onCancel', () => {
      const onCancel = vi.fn();
      render(<ImportPreviewTable preview={mockPreview} onCommit={vi.fn()} onCancel={onCancel} />);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('Diagnostics panel', () => {
    const entries: DiagnosticEntry[] = [
      { timestamp: '2026-01-01T10:00:00Z', errorCode: 'SUCCESS', browserType: 'chrome', operationType: 'switch_slot' },
      { timestamp: '2026-01-01T10:01:00Z', errorCode: 'NO_MATCH', browserType: 'chrome', operationType: 'next_match' },
    ];

    it('should render diagnostic entries without sensitive data', () => {
      render(<DiagnosticsPanel entries={entries} onClear={vi.fn()} onExport={vi.fn()} />);
      expect(screen.getByText('switch_slot')).toBeInTheDocument();
      expect(screen.getByText('NO_MATCH')).toBeInTheDocument();
      // Privacy note
      expect(screen.getByText(/No URLs, titles, or rule content/)).toBeInTheDocument();
    });

    it('should call onClear', () => {
      const onClear = vi.fn().mockResolvedValue(undefined);
      render(<DiagnosticsPanel entries={entries} onClear={onClear} onExport={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Clear diagnostics' }));
      expect(onClear).toHaveBeenCalled();
    });

    it('should call onExport and show status', async () => {
      const onExport = vi.fn().mockResolvedValue('{}');
      render(<DiagnosticsPanel entries={entries} onClear={vi.fn()} onExport={onExport} />);
      fireEvent.click(screen.getByRole('button', { name: 'Export diagnostics' }));
      expect(onExport).toHaveBeenCalled();
    });
  });

  describe('Icon status and retry', () => {
    it('should show cached status', () => {
      render(<IconStatus cached={true} downloadFailed={false} onRetry={vi.fn()} />);
      expect(screen.getByText('Cached')).toBeInTheDocument();
    });

    it('should show download failed with retry button', () => {
      const onRetry = vi.fn();
      render(<IconStatus cached={false} downloadFailed={true} onRetry={onRetry} />);
      expect(screen.getByText('Download failed')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry icon download' }));
      expect(onRetry).toHaveBeenCalled();
    });

    it('should show not cached placeholder state', () => {
      render(<IconStatus cached={false} downloadFailed={false} onRetry={vi.fn()} />);
      expect(screen.getByText('Not cached')).toBeInTheDocument();
    });
  });

  describe('Unified toast', () => {
    it('should render aria-live toast with message', () => {
      render(<UnifiedToast state={{ variant: 'success', message: 'Saved!' }} onDismiss={vi.fn()} />);
      expect(screen.getByRole('alert')).toHaveTextContent('Saved!');
    });

    it('should render nothing when state is null', () => {
      const { container } = render(<UnifiedToast state={null} onDismiss={vi.fn()} />);
      expect(container.innerHTML).toBe('');
    });
  });
});
