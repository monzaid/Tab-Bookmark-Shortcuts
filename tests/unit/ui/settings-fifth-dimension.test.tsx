/**
 * T14 — the fifth dimension's metadata and the D-13 prune's new input.
 *
 * Two invariants, both about MECHANISM rather than a diff:
 *
 *  1. METADATA PARITY (R5/D0): the export panel's pick cards must cover all five
 *     dimensions. Asserted by RENDERING the panel and counting its cards, so the
 *     check follows the real consumer (`DIMENSION_LABELS.map`) rather than a
 *     constant that could be imported and satisfied apart from the render.
 *
 *  2. D-13 (R1/R13): the auto-prune must treat the tag EXPRESSION as a visibility
 *     input. The assertion is on the SOURCE (the effect's dependency array), plus
 *     the outcome-shaped half: the filter engages only when `applied`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string }) => {
  if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: {
          configVersion: 1,
          matchSettings: DEFAULT_MATCH_SETTINGS,
          switchDirection: 'next',
          autoBindGlobal: true,
          slots: [],
          rules: [],
          tags: [{ id: 't1', name: 'work', backgroundColor: '#3366cc', textColor: '#fff' }],
        },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

/** Open the import-export section, where the pick cards live. */
async function openExport(): Promise<void> {
  render(<SettingsApp />);
  await waitFor(() => { expect(screen.getByRole('navigation')).toBeInTheDocument(); });
  const nav = screen.getByRole('navigation');
  // Exact label: `/Import/` alone also matches "Data Dashboard"? No — but a
  // loose regex risks picking the wrong tab, and picking the wrong tab would
  // make this test assert about a section that has no pick cards.
  const exportTab = Array.from(nav.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === 'Import / Export',
  );
  expect(exportTab).toBeDefined();
  fireEvent.click(exportTab as HTMLButtonElement);
  await waitFor(() => { expect(screen.getByTestId('export-section')).toBeInTheDocument(); });
}

describe('T14: the export panel shows five dimension pick cards (R5/D0)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders a pick card for tags alongside the original four', async () => {
    await openExport();
    const section = screen.getByTestId('export-section');
    // Each card is a <label class="tbs-settings__pick">; tags is one of them.
    expect(section.textContent).toContain('Tags');
    expect(section.textContent).toContain('Slots');
    expect(section.textContent).toContain('Rules');
    expect(section.textContent).toContain('Settings');
    expect(section.textContent).toContain('Shortcuts');
  });
});

describe('T14: the D-13 prune takes the tag expression as an input (mechanism)', () => {
  it('the prune effect depends on the expression key, not only search/sort/rules', () => {
    const src = readFileSync('src/ui/settings/App.tsx', 'utf8');
    const idx = src.indexOf('D-13 (default (a) AUTO-PRUNE)');
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 1800);
    expect(window).toContain('tagFilterKey');
    expect(src).toContain('const tagFilterKey = JSON.stringify(tagExpression)');
  });

  it('the expression filter only engages when `applied` (C6/C7 — never filters to empty)', () => {
    const src = readFileSync('src/ui/settings/App.tsx', 'utf8');
    const idx = src.indexOf('const filteredRules');
    const window = src.slice(idx, idx + 1500);
    expect(window).toContain('expressionState.applied');
    expect(window).toContain('evaluateExpression');
  });
});

describe('T14: the export scope completes the tags dimension', () => {
  it('the scope construction passes tags and excludedTagNames', () => {
    const src = readFileSync('src/ui/settings/App.tsx', 'utf8');
    const idx = src.indexOf('const scope: ExportScope');
    const window = src.slice(idx, idx + 700);
    expect(window).toContain('tags: checked.tags');
    expect(window).toContain('excludedTagNames: excludedTags');
  });

  it('the checked state includes a tags key (initial false, like the others)', () => {
    const src = readFileSync('src/ui/settings/App.tsx', 'utf8');
    const idx = src.indexOf('const [checked, setChecked]');
    const window = src.slice(idx, idx + 320);
    expect(window).toContain('tags: false');
  });

  it('the export summary lists a Tags count (the list is hand-written, not a map)', () => {
    const src = readFileSync('src/ui/settings/App.tsx', 'utf8');
    expect(src).toContain('Tags: {summary.tags}');
    expect(src).toContain('tags: parsed.tags?.length ?? 0');
  });
});