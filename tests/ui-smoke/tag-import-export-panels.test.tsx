/**
 * T17 — the import/export panels' tag dimension: the export self-consistency
 * dialog, its two EQUAL options, and the import-side disclosures.
 *
 * The dialog's wording is asserted against the SAME difference the decision uses
 * (D-e/A-f): the names the dialog renders must be exactly the names in the
 * difference. Rendering the difference is what makes text and decision incapable
 * of disagreeing.
 *
 * Equal weight (D-e-D) is the ABSENCE of a default: no `autofocus`, no
 * `aria-current`. A default means an unwitting Enter pushes tag definitions into
 * someone else's machine.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SettingsApp } from '@ui/settings/App';
import { defaultImportIntent } from '@shared/types';
import type { TagDefinition, ExportScope } from '@shared/types';

const TAGS: TagDefinition[] = [
  { id: 'a', name: 'work', backgroundColor: '#3366cc', textColor: '#fff' },
  { id: 'b', name: 'urgent', backgroundColor: '#cc3333', textColor: '#fff' },
];

const RULES = [
  { id: 'r1', urlMatch: { type: 'exact', value: 'https://a/' }, priority: 0, title: 'A', enabled: true, tagIds: ['a'], createdAt: 'x', updatedAt: 'x' },
];

/**
 * The scope of the most recent EXPORT_PACKAGE message, TYPED.
 *
 * `mock.calls` is `any[]`, so reading `c[0].payload.scope` inline is an unsafe
 * member access on `any` — once per assertion. One accessor keeps the assertions
 * readable and the lint honest.
 */
function lastExportScope(): ExportScope {
  const calls = mockSendMessage.mock.calls as Array<[{ action: string; payload?: { scope?: ExportScope } }]>;
  const call = calls.filter((c) => c[0].action === 'EXPORT_PACKAGE').pop();
  const scope = call?.[0].payload?.scope;
  if (!scope) throw new Error('no EXPORT_PACKAGE call carried a scope');
  return scope;
}

const mockSendMessage = vi.fn().mockImplementation((msg: { action: string; payload?: unknown }) => {
  if (msg.action === 'GET_STATE') {
    return {
      result: {
        success: true,
        sync: { configVersion: 1, matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' }, switchDirection: 'next', autoBindGlobal: true, slots: [], rules: RULES, tags: TAGS },
        local: { bindings: [], cycleCursors: [], lastSuccessSlotId: null, recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [] },
      },
    };
  }
  if (msg.action === 'GET_COMMANDS') return { result: { success: true, commands: [] } };
  if (msg.action === 'IMPORT_INSPECT') {
    // A real inspection shape carrying the tags dimension, so the import panel's
    // cards render (the dimension cards come from `inspection.dimensions`).
    return {
      result: {
        success: true,
        inspection: {
          diff: { records: [], dimensions: { slots: false, rules: true, settings: false, shortcuts: false, tags: true } },
          dimensions: { slots: false, rules: true, settings: false, shortcuts: false, tags: true },
          tolerant: [],
          domainViolations: [],
          overlaps: [],
          configVersion: 1,
        },
      },
    };
  }
  if (msg.action === 'EXPORT_PACKAGE') {
    return {
      result: {
        success: true,
        package: JSON.stringify({
          schemaVersion: 1,
          generator: { name: 't', version: '1' },
          exportedAt: '2026-10-11T00:00:00.000Z',
          scope: {},
          tags: [{ name: 'work', backgroundColor: '#3366cc', textColor: '#fff' }],
          rules: [{ id: 'r1', urlMatch: { type: 'exact', value: 'https://a/' }, priority: 0, tags: ['work'] }],
        }),
      },
    };
  }
  return { result: { success: true } };
});

vi.stubGlobal('chrome', {
  runtime: { sendMessage: mockSendMessage, onMessage: { addListener: vi.fn() } },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
});

async function openExport(): Promise<void> {
  render(<SettingsApp />);
  await waitFor(() => { expect(screen.getByRole('navigation')).toBeInTheDocument(); });
  const nav = screen.getByRole('navigation');
  const tab = Array.from(nav.querySelectorAll('button')).find((b) => (b.textContent).trim() === 'Import / Export');
  fireEvent.click(tab as HTMLButtonElement);
  // Import is the DEFAULT half of this section, and the inactive half is hidden —
  // so the Export panel must be selected before its controls are addressable
  // (hidden nodes are excluded from role queries, which is how the panel is
  // meant to behave).
  const exportTab = await screen.findByRole('tab', { name: 'Export' });
  fireEvent.click(exportTab);
  await waitFor(() => { expect(screen.getByTestId('export-section')).toBeInTheDocument(); });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('T17: the export tag picker is a ROW of chips, not one tag per line', () => {
  it('each chip carries the tag\'s own background AND text colour', async () => {
    // The presentation request: the same one-row chip vocabulary the rule forms'
    // tag picker and the expression filter's candidates use. A name-only line said
    // nothing about what the tag looks like, and the chip is where that lives.
    await openExport();
    fireEvent.click(screen.getByTestId('export-dim-tags'));

    const work = await screen.findByTestId('export-record-tag-a');
    const chip = work.querySelector('.tbs-tag-picker__chip') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('work');
    expect(chip.style.backgroundColor).toBe('rgb(51, 102, 204)');
    expect(chip.style.color).toBe('rgb(255, 255, 255)');
  });

  it('the chips share ONE flex row container (so they wrap as a row, not stack)', async () => {
    await openExport();
    fireEvent.click(screen.getByTestId('export-dim-tags'));
    const row = await screen.findByTestId('export-tags-values');
    expect(row.className).toContain('tbs-tag-picker');
    // Both tags are children of that one row — not one `<li>` each in a vertical
    // list, which is the shape this replaced.
    expect(row.querySelectorAll('.tbs-tag-picker__option')).toHaveLength(2);
  });

  it('an excluded tag is dimmed rather than removed, so the row keeps its length', async () => {
    await openExport();
    fireEvent.click(screen.getByTestId('export-dim-tags'));
    const work = await screen.findByTestId('export-record-tag-a');
    expect(work.getAttribute('data-included')).toBe('true');
    fireEvent.click(work.querySelector('input[type=checkbox]') as HTMLInputElement);
    await waitFor(() => { expect(work.getAttribute('data-included')).toBe('false'); });
  });
});

describe('T17: the export panel offers the Tags dimension (R5)', () => {
  it('Tags has a pick card like the other four', async () => {
    await openExport();
    expect(screen.getByTestId('export-dim-tags')).toBeTruthy();
    expect(screen.getByTestId('export-dim-slots')).toBeTruthy();
    expect(screen.getByTestId('export-dim-rules')).toBeTruthy();
  });

  it('unticking a REFERENCED tag raises a dialog whose text renders the difference', async () => {
    await openExport();
    fireEvent.click(screen.getByTestId('export-dim-tags'));
    fireEvent.click(screen.getByTestId('export-dim-rules'));

    // `work` is the referenced tag — untick it. (The Include checkbox lives inside
    // a `<label>` whose text is the tag name; the testid addresses it directly so
    // the test does not depend on the label's rendered text.)
    const includeWork = await screen.findByTestId('export-record-tag-a');
    fireEvent.click((includeWork.querySelector('input[type=checkbox]') as HTMLInputElement));
    fireEvent.click(screen.getByTestId('export-submit'));

    const dialog = await screen.findByRole('dialog', { name: /tags that are not included/i });
    // D-e: the wording names the difference (`work`).
    expect(dialog.textContent).toContain('work');
    // Two options, NEITHER defaulted (D-e-D).
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) {
      expect(b.getAttribute('autofocus')).toBeNull();
      expect(b.getAttribute('aria-current')).toBeNull();
    }
  });

  it('the dialog labels are SHORT, and the consequences live in the body', async () => {
    // The clipping defect: the buttons carried the whole sentence ("Include them
    // (2 extra tag definitions)") inside a dialog capped at 480px, so the labels
    // were cut off. A label states the choice; the numbers belong to the prose.
    await openExport();
    fireEvent.click(screen.getByTestId('export-dim-tags'));
    fireEvent.click(screen.getByTestId('export-dim-rules'));
    const includeWork = await screen.findByTestId('export-record-tag-a');
    fireEvent.click((includeWork.querySelector('input[type=checkbox]') as HTMLInputElement));
    fireEvent.click(screen.getByTestId('export-submit'));

    const dialog = await screen.findByRole('dialog', { name: /tags that are not included/i });
    const include = within(dialog).getByTestId('export-consistency-include');
    const leave = within(dialog).getByTestId('export-consistency-leave');
    expect(include.textContent).toBe('Include them');
    expect(leave.textContent).toBe('Leave them out');
    // ...and the numbers are still stated, just not inside the buttons.
    expect(dialog.textContent).toMatch(/1 extra tag definition/);
    expect(dialog.textContent).toMatch(/1 rule keeps its reference/);
  });

  it('"Include them" actually SHIPS the missing tag definition', async () => {
    // The reported defect: the button re-exported the OLD scope, so the tags stayed
    // missing and the package still had no `tags` node for them. The repair has to
    // be visible in the file, not only in the dialog closing.
    await openExport();
    fireEvent.click(screen.getByTestId('export-dim-tags'));
    fireEvent.click(screen.getByTestId('export-dim-rules'));
    const includeWork = await screen.findByTestId('export-record-tag-a');
    fireEvent.click((includeWork.querySelector('input[type=checkbox]') as HTMLInputElement));
    fireEvent.click(screen.getByTestId('export-submit'));
    await screen.findByRole('dialog', { name: /tags that are not included/i });

    const callsBefore = mockSendMessage.mock.calls.length;
    fireEvent.click(screen.getByTestId('export-consistency-include'));
    await waitFor(() => { expect(mockSendMessage.mock.calls.length).toBeGreaterThan(callsBefore); });

    // The export that ran carries the tag the user just un-excluded.
    const scope = lastExportScope();
    expect(scope.excludedTagNames ?? []).not.toContain('work');
  });

  it('"Leave them out" asks for the orphan reference to be STRIPPED', async () => {
    // The other half: this answer used to fall through to a plain re-export, so the
    // two buttons produced the same file and the difference the dialog described
    // was implemented nowhere.
    await openExport();
    fireEvent.click(screen.getByTestId('export-dim-tags'));
    fireEvent.click(screen.getByTestId('export-dim-rules'));
    const includeWork = await screen.findByTestId('export-record-tag-a');
    fireEvent.click((includeWork.querySelector('input[type=checkbox]') as HTMLInputElement));
    fireEvent.click(screen.getByTestId('export-submit'));
    await screen.findByRole('dialog', { name: /tags that are not included/i });

    const callsBefore = mockSendMessage.mock.calls.length;
    fireEvent.click(screen.getByTestId('export-consistency-leave'));
    await waitFor(() => { expect(mockSendMessage.mock.calls.length).toBeGreaterThan(callsBefore); });

    const scope = lastExportScope();
    expect(scope.stripOrphanTagNames).toBe(true);
    // The tag stays excluded: "leave them out" is about the REFERENCE, and the
    // vocabulary decision the user already made is not reversed behind their back.
    expect(scope.excludedTagNames ?? []).toContain('work');
  });

  it('unticking an UNREFERENCED tag does NOT raise the dialog (no false dialog)', async () => {
    await openExport();
    fireEvent.click(screen.getByTestId('export-dim-tags'));
    fireEvent.click(screen.getByTestId('export-dim-rules'));

    const includeUrgent = await screen.findByTestId('export-record-tag-b');
    fireEvent.click((includeUrgent.querySelector('input[type=checkbox]') as HTMLInputElement));
    fireEvent.click(screen.getByTestId('export-submit'));

    // No dialog — the package is already self-consistent.
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: /tags that are not included/i })).toBeNull(); });
  });
});

describe('T17: the import panel exposes the tags dimension and the A8 re-decision', () => {
  it('the tags card and its mode selector exist on the import side', async () => {
    render(<SettingsApp />);
    await waitFor(() => { expect(screen.getByRole('navigation')).toBeInTheDocument(); });
    const nav = screen.getByRole('navigation');
    const tab = Array.from(nav.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Import / Export');
    fireEvent.click(tab as HTMLButtonElement);

    const importTab = await screen.findByRole('tab', { name: /Import/i });
    fireEvent.click(importTab);

    // Feed a package through the file input so the inspection (and the cards) render.
    const file = JSON.stringify({
      schemaVersion: 1,
      generator: { name: 't', version: '1' },
      exportedAt: '2026-10-11T00:00:00.000Z',
      scope: {},
      tags: [{ name: 'work', backgroundColor: '#3366cc', textColor: '#fff' }],
      rules: [{ id: 'r1', urlMatch: { type: 'exact', value: 'https://a/' }, priority: 0, tags: ['work'] }],
    });
    const input = screen.getByTestId<HTMLInputElement>('import-file-input');
    const fileObj = new File([file], 'pkg.json', { type: 'application/json' });
    // jsdom: `File.text()` is available; fire the change with the file attached.
    Object.defineProperty(fileObj, 'text', { value: () => Promise.resolve(file) });
    fireEvent.change(input, { target: { files: [fileObj] } });

    await waitFor(() => { expect(screen.getByTestId('import-mode-tags')).toBeInTheDocument(); });

    // A8: choosing overwrite reveals the re-decision control.
    fireEvent.change(screen.getByTestId('import-mode-tags'), { target: { value: 'overwrite' } });
    await waitFor(() => { expect(screen.getByTestId('import-tags-to-incremental')).toBeInTheDocument(); });
  });
});

describe('T17: intent defaults keep the tags dimension incremental (A7)', () => {
  it('defaultImportIntent().dimensionModes.tags is incremental', () => {
    expect(defaultImportIntent().dimensionModes.tags).toBe('incremental');
  });
});
