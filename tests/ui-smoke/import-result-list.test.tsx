/**
 * T22 — the APPLY result list (design §4.3).
 *
 * Six groups: success counts, tolerant items, DOMAIN VIOLATIONS, missing icons,
 * match overlaps, shortcut guidance. Assertions are structural/copy-only (jsdom).
 *
 * The two points that carry real risk:
 *  - D15: domain violations are a SEPARATE group from tolerant items, and have
 *    no dismiss affordance (a safety disclosure is not a choice);
 *  - D9: the missing-icon entry REVEALS the record's own surface and writes
 *    NOTHING (C9 forbids a persisted "needs re-selection" marker).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ImportApplyResult } from '@shared/types';

const FILE_TEXT = JSON.stringify({
  schemaVersion: 1,
  generator: { name: 'test', version: '1' },
  exportedAt: '2026-10-05T00:00:00.000Z',
  scope: { rules: true },
  rules: [],
});

/** An APPLY result carrying every group, so "empty groups don't render" is testable. */
const FULL_RESULT: ImportApplyResult = {
  success: true,
  configVersion: 6,
  counts: { added: 2, replaced: 1, kept: 3, deleted: 4, skipped: 5 },
  tolerant: [
    { kind: 'unknown-field', detail: 'futureTopLevel' },
    { kind: 'unknown-field', detail: 'rules[0].mystery' },
  ],
  domainViolations: [
    { kind: 'rule', id: 'bad-1', reason: 'Rule bad-1 has an unsafe regex: catastrophic' },
  ],
  missingIcons: [
    { kind: 'rule', id: 'r-missing' },
    { kind: 'slot', id: 3 },
  ],
  overlaps: [
    { urlMatch: { type: 'exact', value: 'https://dup.example/' }, recordIds: ['r1', 'r2'] },
  ],
  shortcutGuidance: 'The shortcuts in this import must be set manually at chrome://extensions/shortcuts',
};

const EMPTY_RESULT: ImportApplyResult = {
  success: true,
  configVersion: 6,
  counts: { added: 0, replaced: 0, kept: 1, deleted: 0, skipped: 0 },
  tolerant: [],
  domainViolations: [],
  missingIcons: [],
  overlaps: [],
};

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: 1, windowId: 1, url: '', title: '' }),
    update: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

const SYNC = {
  configVersion: 5,
  matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
  switchDirection: 'next',
  autoBindGlobal: false,
  slots: [],
  rules: [],
};

function installMock(result: ImportApplyResult) {
  mockSendMessage.mockImplementation((msg: { action?: string }) => {
    if (msg.action === 'IMPORT_INSPECT') {
      return Promise.resolve({
        result: {
          success: true,
          inspection: {
            diff: { records: [], dimensions: { slots: false, rules: true, settings: false, shortcuts: false } },
            dimensions: { slots: false, rules: true, settings: false, shortcuts: false },
            tolerant: [], domainViolations: [], overlaps: [], configVersion: 5,
          },
        },
      });
    }
    if (msg.action === 'IMPORT_APPLY') {
      return Promise.resolve({ result: { success: true, configVersion: 6, result } });
    }
    if (msg.action === 'GET_COMMANDS') {
      return Promise.resolve({ result: { success: true, commands: [] } });
    }
    return Promise.resolve({
      result: {
        success: true,
        sync: { ...SYNC },
        local: {
          bindings: [], cycleCursors: [], lastSuccessSlotId: null,
          recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [],
        },
      },
    });
  });
}

/** `Blob.text()` may be absent in jsdom; without it the file reads as `''`. */
function makeFile(text: string): File {
  const file = new File([text], 'package.json', { type: 'application/json' });
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  }
  return file;
}

/** Choose a file, open the (constant) confirm dialog, confirm, and settle. */
async function applyImport(result: ImportApplyResult) {
  installMock(result);
  const { SettingsApp } = await import('@ui/settings/App');
  render(<SettingsApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'Import / Export' }));
  await screen.findByRole('heading', { name: /import/i });

  const input = screen.getByTestId('import-file-input');
  fireEvent.change(input, { target: { files: [makeFile(FILE_TEXT)] } });
  await screen.findByTestId('import-diff');

  const apply = screen.getByTestId('import-apply');
  await waitFor(() => { expect(apply).not.toBeDisabled(); });
  fireEvent.click(apply);
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /confirm import/i }));

  return screen.findByTestId('import-result');
}

describe('T22 — import result list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the success counts', async () => {
    const view = await applyImport(FULL_RESULT);
    expect(within(view).getByTestId('import-result-count-added').textContent).toMatch(/2/);
    expect(within(view).getByTestId('import-result-count-deleted').textContent).toMatch(/4/);
  });

  it('keeps domain violations SEPARATE from tolerant items, and non-dismissible (D15)', async () => {
    const view = await applyImport(FULL_RESULT);

    const violations = within(view).getByTestId('import-violations');
    const tolerant = within(view).getByTestId('import-tolerant');
    // Different containers, and neither record appears in the other (反串组).
    expect(violations.textContent).toMatch(/unsafe/i);
    expect(violations.textContent).not.toMatch(/futureTopLevel/);
    expect(tolerant.textContent).not.toMatch(/unsafe/i);
    // A safety disclosure offers no way to wave it away.
    expect(within(violations).queryByRole('button')).toBeNull();
  });

  it('collapses tolerant items behind a count and expands to the details', async () => {
    const view = await applyImport(FULL_RESULT);
    expect(within(view).getByTestId('import-tolerant-summary').textContent).toMatch(/2 fields/);
    const box = within(view).getByTestId('import-tolerant') as HTMLDetailsElement;
    box.open = true;
    expect(within(box).getByTestId('import-tolerant-item-1').textContent).toMatch(/mystery/);
  });

  it('lists missing icons with a repair entry that writes NOTHING (C9)', async () => {
    const view = await applyImport(FULL_RESULT);
    expect(view.textContent).toMatch(/2 icons need to be re-selected/i);

    mockSendMessage.mockClear();
    fireEvent.click(within(view).getByTestId('import-missing-repair-rule-r-missing'));
    // It navigates to the record's own surface — it must not persist any marker.
    const writes = mockSendMessage.mock.calls.filter((c) => {
      const action = (c[0] as { action?: string }).action ?? '';
      return action !== 'GET_STATE' && action !== 'GET_COMMANDS';
    });
    expect(writes).toHaveLength(0);
  });

  it('reports match overlaps and the shortcut guidance', async () => {
    const view = await applyImport(FULL_RESULT);
    expect(within(view).getByTestId('import-overlaps').textContent).toMatch(/1 match overlap/i);
    expect(within(view).getByTestId('import-shortcut-guidance').textContent)
      .toContain('chrome://extensions/shortcuts');
  });

  it('renders NO empty group', async () => {
    const view = await applyImport(EMPTY_RESULT);
    for (const id of ['import-tolerant', 'import-violations', 'import-missing-icons', 'import-overlaps', 'import-shortcut-guidance']) {
      expect(within(view).queryByTestId(id)).toBeNull();
    }
    // The counts group is always present (it is the summary).
    expect(within(view).getByTestId('import-result-counts')).toBeTruthy();
  });
});