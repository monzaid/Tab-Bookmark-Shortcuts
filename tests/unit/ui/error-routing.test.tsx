/**
 * T19 — error ownership routing (E3/E3b) + copy unification (D-a-1 / E2-c).
 *
 * A create failure is a FORM/field-level error: it must show up ONCE (inside the
 * form), never as an additional global error toast (the old double-alert, N6).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: { getURL: (p: string) => `chrome-extension://test/${p}`, sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 42, windowId: 1, index: 0, url: 'https://example.com/page', title: 'Site', favIconUrl: '', active: true, incognito: false, status: 'complete' }]),
    get: vi.fn(), update: vi.fn(), create: vi.fn(),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: { local: { get: vi.fn().mockResolvedValue({}) }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

const BASE = {
  result: {
    success: true,
    sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: [] },
    local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('T19: error routing', () => {
  it('an invalid regex shows ONLY an inline field error (no global error toast)', async () => {
    mockSendMessage.mockResolvedValue(BASE);
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });

    fireEvent.click(within(dialog).getByLabelText('Regex pattern'));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Match URL/ }), { target: { value: '(a+)+$' } });

    // A single inline field-level alert — no toast alongside it.
    const alerts = within(dialog).getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(document.querySelector('.tbs-toast--error')).toBeNull();
  });

  it('a CREATE_RULE failure does not raise a global error toast (N6 fixed)', async () => {
    mockSendMessage.mockImplementation((msg: { action: string }) => {
      if (msg.action === 'CREATE_RULE') {
        return Promise.resolve({ result: { success: false, errorCode: 'DUPLICATE_RULE', message: 'A rule with the same match pattern already exists.' } });
      }
      return Promise.resolve(BASE);
    });
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Match URL/ }), { target: { value: 'https://dup.example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toBeInTheDocument();
    });
    // No second, global error surface.
    expect(document.querySelector('.tbs-toast--error')).toBeNull();
  });

  it('unified conflict copy is used (E2-c)', async () => {
    mockSendMessage.mockImplementation((msg: { action: string }) => {
      if (msg.action === 'CREATE_RULE') {
        return Promise.resolve({ result: { success: false, errorCode: 'RULE_CONFLICT_BLOCK', message: 'A rule with the same URL already exists', conflict: { conflictingRuleId: 'r1' } } });
      }
      return Promise.resolve(BASE);
    });
    render(<SidebarApp />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add to global rules' }));
    const dialog = await screen.findByRole('dialog', { name: /New Global Page Rule/ });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Match URL/ }), { target: { value: 'https://conflict.example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('A rule with the same URL already exists');
    });
  });
});