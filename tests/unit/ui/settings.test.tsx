import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';

// Mock chrome.runtime.sendMessage
const mockSendMessage = vi.fn().mockImplementation(async (msg: { action: string }) => {
  if (msg.action === 'GET_COMMANDS') {
    return {
      result: {
        success: true,
        commands: Array.from({ length: 21 }, (_, i) => ({
          name: i < 20 ? `${i % 2 === 0 ? 'save' : 'switch'}-slot-${Math.floor(i / 2) + 1}` : 'next-match',
          description: i < 20 ? `${i % 2 === 0 ? 'Save' : 'Switch'} slot ${Math.floor(i / 2) + 1}` : 'Next match',
          shortcut: i < 3 ? `Ctrl+Shift+${i + 1}` : null,
        })),
      },
    };
  }
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: {
          configVersion: 1,
          matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
          switchDirection: 'next',
          autoBindGlobal: true,
          slots: [],
          rules: [],
        },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

describe('T17: Settings — slots, strategy, shortcuts sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy path — commands display and strategy edit', () => {
    it('should render 21 commands with shortcut status', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        const rows = screen.getAllByRole('row');
        // 1 header + 21 command rows
        expect(rows.length).toBe(22);
      });
    });

    it('should show active/no-shortcut status badges', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getAllByText('✅ Active').length).toBe(3);
        expect(screen.getAllByText('⚠️ No shortcut').length).toBe(18);
      });
    });

    it('should show browser shortcut management hint', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByText(/chrome:\/\/extensions\/shortcuts/)).toBeInTheDocument();
      });
    });

    // ── U8 (P9) — appended only (GE3); every case above is untouched ────────
    it('should use the English "Not set" placeholder for commands without a shortcut', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
      });
      expect(screen.queryByText('未设置')).toBeNull();
    });

    it('should navigate between sections', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('navigation', { name: 'Settings navigation' })).toBeInTheDocument();
      });

      // Click strategy section
      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));
      expect(screen.getByRole('region', { name: 'Global matching settings' })).toBeInTheDocument();
    });

    it('should render the global tri-knob controls with defaults', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));

      expect(screen.getByLabelText('Global Tab ID')).toHaveValue('exists');
      expect(screen.getByLabelText('Global Rule Check')).toHaveValue('match');
      expect(screen.getByLabelText('Global Priority')).toHaveValue('tabId');
      expect(screen.getByLabelText('Switch Direction')).toHaveValue('next');
    });

    it('should render 10 per-slot strategy selects', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));

      const slotSelects = screen.getAllByRole('combobox', { name: /Strategy for slot/ });
      expect(slotSelects).toHaveLength(10);
      expect(slotSelects[0]).toHaveValue('inherit');
    });

    it('should send SET_GLOBAL_STRATEGY with matchSettings on knob change', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));

      fireEvent.change(screen.getByLabelText('Global Rule Check'), { target: { value: 'no-match' } });

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'SET_GLOBAL_STRATEGY',
            payload: { matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'no-match', priority: 'tabId' } },
          })
        );
      });
    });
  });

  describe('Error path — version conflict and API failure', () => {
    it('should show conflict banner on CONFIG_CONFLICT', async () => {
      mockSendMessage.mockImplementation(async (msg: { action: string }) => {
        if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
        if (msg.action === 'GET_STATE') return { result: { success: true, sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] }, local: {} } };
        if (msg.action === 'SET_GLOBAL_STRATEGY') return { result: { success: false, errorCode: 'CONFIG_CONFLICT', message: 'conflict' } };
        return { result: { success: true } };
      });

      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));
      fireEvent.change(screen.getByLabelText('Global Priority'), { target: { value: 'none' } });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/changed externally/);
      });
    });

    it('should not expose raw error text to user', async () => {
      mockSendMessage.mockImplementation(async (msg: { action: string }) => {
        if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
        if (msg.action === 'GET_STATE') return { result: { success: true, sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] }, local: {} } };
        if (msg.action === 'SET_GLOBAL_STRATEGY') return { result: { success: false, errorCode: 'BROWSER_API_ERROR', message: 'chrome.runtime.lastError: internal' } };
        return { result: { success: true } };
      });

      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));
      fireEvent.change(screen.getByLabelText('Global Rule Check'), { target: { value: 'no-match' } });

      await waitFor(() => {
        // Should show safe message, not raw error
        expect(screen.queryByText(/chrome\.runtime\.lastError/)).not.toBeInTheDocument();
      });
    });
  });
});
