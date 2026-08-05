import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RuleEditor } from '@ui/settings/RuleEditor';
import type { PageRule } from '@shared/types';

const mockRules: PageRule[] = [
  { id: 'r1', urlMatch: { type: 'regex', value: 'https://github\\.com/.*' }, mode: 'auto', priority: 10, title: 'GitHub', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'r2', urlMatch: { type: 'exact', value: 'https://example.com' }, mode: 'manual', priority: 5, createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
];

describe('T18: Rule table, detail drawer, full edit, conflict confirmation', () => {
  const defaultProps = {
    rules: mockRules,
    onCreate: vi.fn().mockResolvedValue({ success: true }),
    onUpdate: vi.fn().mockResolvedValue({ success: true }),
    onDelete: vi.fn().mockResolvedValue({ success: true }),
  };

  describe('Happy path — create, filter, detail', () => {
    it('should render rule table with all rules', () => {
      render(<RuleEditor {...defaultProps} />);
      expect(screen.getByRole('table', { name: 'Page rules' })).toBeInTheDocument();
      expect(screen.getByText(/github\\.com/)).toBeInTheDocument();
      expect(screen.getByText('https://example.com')).toBeInTheDocument();
    });

    it('should filter by mode', () => {
      render(<RuleEditor {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Filter rules'), { target: { value: 'manual' } });
      expect(screen.getByText('https://example.com')).toBeInTheDocument();
      expect(screen.queryByText(/github\\.com/)).not.toBeInTheDocument();
    });

    it('should search by URL pattern', () => {
      render(<RuleEditor {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('Search rules'), { target: { value: 'github' } });
      expect(screen.getByText(/github\\.com/)).toBeInTheDocument();
      expect(screen.queryByText('https://example.com')).not.toBeInTheDocument();
    });

    it('should open create dialog with priority field', () => {
      render(<RuleEditor {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText('Rule priority')).toHaveValue(0);
    });

    it('should save new rule via dialog', async () => {
      const onCreate = vi.fn().mockResolvedValue({ success: true });
      render(<RuleEditor {...defaultProps} onCreate={onCreate} />);

      fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));
      fireEvent.change(screen.getByLabelText('URL pattern value'), { target: { value: 'https://new.com' } });
      fireEvent.change(screen.getByLabelText('Rule priority'), { target: { value: '10' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
          urlMatch: { type: 'exact', value: 'https://new.com' },
          priority: 10,
        }));
      });
    });

    it('should show detail drawer after closing edit dialog', () => {
      render(<RuleEditor {...defaultProps} />);
      // Click row opens edit dialog
      fireEvent.click(screen.getByText(/github\\.com/));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // Close dialog — drawer should appear
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByText('Rule Detail')).toBeInTheDocument();
    });
  });

  describe('Error path — 501 chars, explicit conflict, uncertain overlap', () => {
    it('should reject regex exceeding 500 characters', async () => {
      render(<RuleEditor {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));

      // Switch to regex mode
      fireEvent.change(screen.getByLabelText('URL match type'), { target: { value: 'regex' } });
      fireEvent.change(screen.getByLabelText('URL pattern value'), { target: { value: 'a'.repeat(501) } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText(/500 character limit/)).toBeInTheDocument();
      });
    });

    it('should block save for explicit conflict (same URL)', async () => {
      render(<RuleEditor {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));

      // Enter same URL as existing rule
      fireEvent.change(screen.getByLabelText('URL pattern value'), { target: { value: 'https://example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText(/same URL already exists/)).toBeInTheDocument();
      });
    });

    it('should show secondary confirmation for uncertain overlap', async () => {
      render(<RuleEditor {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));

      // Switch to regex and enter overlapping pattern
      fireEvent.change(screen.getByLabelText('URL match type'), { target: { value: 'regex' } });
      fireEvent.change(screen.getByLabelText('URL pattern value'), { target: { value: 'https://.*\\.com/.*' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText(/may overlap/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Save Anyway' })).toBeInTheDocument();
      });
    });

    it('should reject protected URL rules', async () => {
      render(<RuleEditor {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));

      fireEvent.change(screen.getByLabelText('URL pattern value'), { target: { value: 'chrome://settings' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(screen.getByText(/protected internal pages/)).toBeInTheDocument();
      });
    });

    it('should show delete confirmation with rule info', () => {
      render(<RuleEditor {...defaultProps} />);
      // Click row to select, then close edit dialog to show drawer
      fireEvent.click(screen.getByText(/github\\.com/));
      // The edit dialog opens — close it
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      // Now drawer should show with delete button
      fireEvent.click(screen.getByRole('button', { name: 'Delete Rule' }));
      expect(screen.getByText(/Delete rule/)).toBeInTheDocument();
    });
  });
});
