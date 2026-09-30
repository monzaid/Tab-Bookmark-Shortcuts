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
        sync: { configVersion: 1, globalStrategy: 'B', slots: [], rules: [] },
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
      expect(screen.getByRole('radiogroup', { name: 'Global default strategy' })).toBeInTheDocument();
    });

    it('should render global strategy radios with B checked', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));

      const radioB = screen.getByRole('radio', { name: /B\./ });
      expect(radioB).toBeChecked();
    });

    it('should render 10 per-slot strategy selects', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));

      const slotSelects = screen.getAllByRole('combobox', { name: /Strategy for slot/ });
      expect(slotSelects).toHaveLength(10);
    });

    it('should send SET_GLOBAL_STRATEGY on radio change', async () => {
      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));

      const radioC = screen.getByRole('radio', { name: /C\./ });
      fireEvent.click(radioC);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'SET_GLOBAL_STRATEGY',
            payload: { strategy: 'C' },
          })
        );
      });
    });
  });

  describe('Error path — version conflict and API failure', () => {
    it('should show conflict banner on CONFIG_CONFLICT', async () => {
      mockSendMessage.mockImplementation(async (msg: { action: string }) => {
        if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
        if (msg.action === 'GET_STATE') return { result: { success: true, sync: { configVersion: 1, globalStrategy: 'B', slots: [], rules: [] }, local: {} } };
        if (msg.action === 'SET_GLOBAL_STRATEGY') return { result: { success: false, errorCode: 'CONFIG_CONFLICT', message: 'conflict' } };
        return { result: { success: true } };
      });

      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));
      fireEvent.click(screen.getByRole('radio', { name: /A\./ }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/changed externally/);
      });
    });

    it('should not expose raw error text to user', async () => {
      mockSendMessage.mockImplementation(async (msg: { action: string }) => {
        if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
        if (msg.action === 'GET_STATE') return { result: { success: true, sync: { configVersion: 1, globalStrategy: 'B', slots: [], rules: [] }, local: {} } };
        if (msg.action === 'SET_GLOBAL_STRATEGY') return { result: { success: false, errorCode: 'BROWSER_API_ERROR', message: 'chrome.runtime.lastError: internal' } };
        return { result: { success: true } };
      });

      render(<SettingsApp />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Global Strategy' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Global Strategy' }));
      fireEvent.click(screen.getByRole('radio', { name: /C\./ }));

      await waitFor(() => {
        // Should show safe message, not raw error
        expect(screen.queryByText(/chrome\.runtime\.lastError/)).not.toBeInTheDocument();
      });
    });
  });
});
