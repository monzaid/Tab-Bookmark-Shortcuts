/**
 * T19 — the independent export section (Q2=B-2: a section INSIDE settings,
 * alongside the import one; no new HTML page, no new build entry).
 *
 * Structure/copy assertions only (jsdom). The points that must hold:
 *  - the four fixed dimensions are checkboxes (D5/D1);
 *  - an EMPTY selection is blocked with a visible reason (D1 derived: "export
 *    nothing" is not a legal export);
 *  - Export sends `EXPORT_PACKAGE` with the chosen scope;
 *  - the package summary is shown BEFORE the download (show-then-download).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';

const PACKAGE_JSON = JSON.stringify({
  schemaVersion: 1,
  scope: { rules: true },
  slots: [],
  rules: [{ id: 'r1' }, { id: 'r2' }],
});

const mockSendMessage = vi.fn();

/**
 * The machine state the next GET_STATE reports, so a test can simulate an edit
 * made in the sidebar / Rules section and then assert the panel caught up.
 */
let targetState: { slotTitle: string; extraRuleId: string | null } = { slotTitle: 'S1', extraRuleId: null };

/**
 * Captured `storage.onChanged` listeners, so a test can raise an external change
 * the way the browser does. Declared here because the refresh under test is driven
 * entirely by that signal — a test that cannot fire it cannot see the difference.
 */
const storageListeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];

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
    onChanged: {
      addListener: vi.fn((fn: (changes: Record<string, unknown>, area: string) => void) => {
        storageListeners.push(fn);
      }),
      removeListener: vi.fn((fn: (changes: Record<string, unknown>, area: string) => void) => {
        const i = storageListeners.indexOf(fn);
        if (i >= 0) storageListeners.splice(i, 1);
      }),
    },
  },
});

vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock'),
  revokeObjectURL: vi.fn(),
});

function installMock(slotTitle = 'S1') {
  targetState = { slotTitle, extraRuleId: null };
  mockSendMessage.mockImplementation((msg: { action?: string }) => {
    if (msg.action === 'EXPORT_PACKAGE') {
      return Promise.resolve({ result: { success: true, package: PACKAGE_JSON } });
    }
    if (msg.action === 'GET_COMMANDS') {
      return Promise.resolve({ result: { success: true, commands: [] } });
    }
    // Read `targetState` at CALL time, not at install time: a refresh is only
    // observable if the second read can return something different.
    const rules = [
      { id: 'r1', urlMatch: { type: 'exact', value: 'https://a.example/' }, priority: 0, createdAt: '', updatedAt: '' },
    ];
    if (targetState.extraRuleId !== null) {
      rules.push({
        id: targetState.extraRuleId,
        urlMatch: { type: 'exact', value: 'https://added.example/' },
        priority: 0,
        createdAt: '',
        updatedAt: '',
      });
    }
    return Promise.resolve({
      result: {
        success: true,
        sync: {
          configVersion: 5,
          matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
          switchDirection: 'next',
          autoBindGlobal: true,
          // T19-C needs real records to expand; the summary comes from the
          // EXPORT_PACKAGE payload, so the counts here are independent.
          slots: [
            { id: 1, urlMatch: { type: 'exact', value: 'https://s1.example/' }, strategy: 'inherit', uiMarker: {}, titleSnapshot: targetState.slotTitle, faviconSnapshot: '', createdAt: '', updatedAt: '' },
          ],
          rules,
        },
        local: {
          bindings: [], cycleCursors: [], lastSuccessSlotId: null,
          recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [],
        },
      },
    });
  });
}

async function openExportSection(slotTitle = 'S1') {
  installMock(slotTitle);
  const { SettingsApp } = await import('@ui/settings/App');
  const view = render(<SettingsApp />);
  const nav = await screen.findByRole('button', { name: 'Import / Export' });
  fireEvent.click(nav);
  // Two headings match /export/i ("Import / Export" + "Export"), so wait on the
  // section's own control instead of an ambiguous role query.
  await screen.findByTestId('export-dim-slots');
  return view;
}

describe('T19 — independent export section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageListeners.length = 0;
  });

  it('follows a change made elsewhere and re-reads the target-machine values', async () => {
    // The reported defect: edit a slot in the sidebar / a rule on the Rules
    // section, and the export lists kept describing the state read when the
    // panel mounted. The refresh is driven by `storage.onChanged`, so the test
    // raises that signal the way the browser does, then asserts the LIST changed
    // — a bare "GET_STATE was called twice" would pass without any re-render.
    await openExportSection();
    fireEvent.click(screen.getByTestId('export-dim-rules'));
    await screen.findByTestId('export-records-rules');

    // Before: only r1 is on the machine.
    expect(screen.queryByTestId('export-rules-row-r-added')).toBeNull();

    // Someone adds a rule elsewhere, and storage broadcasts it.
    targetState = { slotTitle: 'S1', extraRuleId: 'r-added' };
    act(() => {
      for (const listener of storageListeners) listener({ syncState: {} }, 'sync');
    });

    expect(await screen.findByTestId('export-rules-row-r-added')).toBeTruthy();
  });

  it('follows a slot title edited elsewhere', async () => {
    await openExportSection('S1');
    fireEvent.click(screen.getByTestId('export-dim-slots'));
    await screen.findByTestId('export-records-slots');
    expect(screen.getByTestId('export-slots-row-1').textContent).toMatch(/S1/);

    targetState = { slotTitle: 'RENAMED', extraRuleId: null };
    act(() => {
      for (const listener of storageListeners) listener({ syncState: {} }, 'sync');
    });

    await waitFor(() => {
      expect(screen.getByTestId('export-slots-row-1').textContent).toMatch(/RENAMED/);
    });
  });

  it('shows the title the user EDITED, not the save-time snapshot', async () => {
    // The reported "the list never refreshes": a slot renamed in the sidebar or
    // the Data Dashboard writes `uiMarker.customTitle`, while `titleSnapshot`
    // keeps the page title captured when the slot was saved. Reading the snapshot
    // made a rename invisible however often the list was refreshed.
    installMock('Original');
    // The machine holds an EDITED title on the same slot.
    targetState = { slotTitle: 'Original', extraRuleId: null };
    const editedSync = {
      configVersion: 5,
      matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
      switchDirection: 'next',
      autoBindGlobal: true,
      slots: [{
        id: 1,
        urlMatch: { type: 'exact', value: 'https://s1.example/' },
        strategy: 'inherit',
        uiMarker: { customTitle: 'Edited Name' },
        titleSnapshot: 'Original',
        faviconSnapshot: '',
        createdAt: '',
        updatedAt: '',
      }],
      rules: [],
    };
    const inner = mockSendMessage.getMockImplementation();
    mockSendMessage.mockImplementation((msg: { action?: string }) =>
      msg.action === 'GET_STATE'
        ? Promise.resolve({
            result: {
              success: true,
              sync: editedSync,
              local: {
                bindings: [], cycleCursors: [], lastSuccessSlotId: null,
                recoverySessions: [], recoverySnapshots: [], tabOverrides: [], iconCache: {}, diagnostics: [],
              },
            },
          })
        : (inner ? inner(msg) : Promise.resolve({ result: { success: true } })));

    const { SettingsApp } = await import('@ui/settings/App');
    render(<SettingsApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Import / Export' }));
    fireEvent.click(await screen.findByTestId('export-dim-slots'));
    await screen.findByTestId('export-records-slots');

    const row = await screen.findByTestId('export-slots-row-1');
    expect(row.textContent).toMatch(/Edited Name/);
    expect(row.textContent).not.toMatch(/Original/);
  });

  it('offers a manual refresh that re-reads the machine', async () => {
    // The automatic path listens for `storage.onChanged`, which does not cover
    // every real case (a Service Worker that was asleep when the write landed).
    // The button is the fallback: pressing it must actually re-read.
    await openExportSection();
    fireEvent.click(screen.getByTestId('export-dim-rules'));
    await screen.findByTestId('export-records-rules');
    expect(screen.queryByTestId('export-rules-row-r-added')).toBeNull();

    targetState = { slotTitle: 'S1', extraRuleId: 'r-added' };
    fireEvent.click(screen.getByTestId('import-export-refresh'));

    expect(await screen.findByTestId('export-rules-row-r-added')).toBeTruthy();
  });

  it('warns that the target machine may have changed, and clears it after a refresh', async () => {
    await openExportSection();

    // Nothing has moved yet: no warning.
    expect(screen.queryByTestId('import-export-refresh-stale')).toBeNull();

    // A write elsewhere (a sidebar slot edit lands in `sync`).
    act(() => {
      for (const listener of storageListeners) listener({ syncState: {} }, 'sync');
    });
    expect(screen.getByTestId('import-export-refresh-stale')).toBeTruthy();
    // The hint is ALSO text, not just a coloured dot.
    expect(screen.getByTestId('import-export-refresh').textContent).toMatch(/may have changed/i);

    fireEvent.click(screen.getByTestId('import-export-refresh'));
    await waitFor(() => {
      expect(screen.queryByTestId('import-export-refresh-stale')).toBeNull();
    });
  });

  it('renders the four dimension checkboxes and blocks an empty selection (D1)', async () => {
    await openExportSection();

    for (const dim of ['slots', 'rules', 'settings', 'shortcuts']) {
      expect(screen.getByTestId(`export-dim-${dim}`)).toBeTruthy();
    }

    // Nothing checked yet → Export is blocked with a visible reason.
    const submit = screen.getByTestId('export-submit');
    expect(submit).toBeDisabled();
    expect(screen.getByTestId('export-empty-reason')).toBeTruthy();
  });

  it('exports the chosen scope and shows the package summary before download', async () => {
    await openExportSection();

    fireEvent.click(screen.getByTestId('export-dim-rules'));
    expect(screen.getByTestId('export-submit')).not.toBeDisabled();

    mockSendMessage.mockClear();
    fireEvent.click(screen.getByTestId('export-submit'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EXPORT_PACKAGE' }),
      );
    });
    const call = mockSendMessage.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'EXPORT_PACKAGE',
    );
    expect((call?.[0] as { payload: { scope: { rules?: boolean } } }).payload.scope).toEqual(
      expect.objectContaining({ rules: true }),
    );

    // Summary shown first; the download is a separate, explicit step.
    const summary = await screen.findByTestId('export-summary');
    // Scoped to THIS row's count, not a bare "Rules" that is always present.
    expect(summary.textContent).toMatch(/Rules:\s*2/);
    // A dimension that was NOT chosen reports 0 (R-1).
    expect(summary.textContent).toMatch(/Slots:\s*0/);
    expect(screen.getByTestId('export-download')).toBeTruthy();
  });

  it('enables the shortcuts dimension now that a producer exists', async () => {
    await openExportSection();

    // The dimension used to be disabled with a "not supported yet" note while
    // no producer existed. Bindings now come from the browser's own commands, so
    // the control must be usable like the other three.
    const shortcuts = screen.getByTestId('export-dim-shortcuts');
    expect(shortcuts).not.toBeDisabled();
    expect(screen.queryByTestId('export-shortcuts-reason')).toBeNull();
    expect(screen.getByTestId('export-dim-slots')).not.toBeDisabled();
  });

  it('lists the slots as records and deselects one into the scope (T19-C)', async () => {
    await openExportSection();

    fireEvent.click(screen.getByTestId('export-dim-slots'));

    // The list renders directly under the pick card (no disclosure to open) and
    // each row carries its icon cell, so a slot is verifiable by what it shows.
    await screen.findByTestId('export-records-slots');
    const row = await screen.findByTestId('export-slots-row-1');
    expect(within(row).getByTestId('export-record-slot-1')).toBeTruthy();

    fireEvent.click(screen.getByTestId('export-record-slot-1'));

    mockSendMessage.mockClear();
    fireEvent.click(screen.getByTestId('export-submit'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EXPORT_PACKAGE' }),
      );
    });
    const call = mockSendMessage.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'EXPORT_PACKAGE',
    );
    const sentScope = (call?.[0] as { payload: { scope: { slots?: boolean; excludedSlotIds?: number[] } } })
      .payload.scope;
    expect(sentScope.slots).toBe(true);
    expect(sentScope.excludedSlotIds).toContain(1);
  });

  it('selects and clears every record from the list toolbar (需求1)', async () => {
    await openExportSection();
    fireEvent.click(screen.getByTestId('export-dim-slots'));
    await screen.findByTestId('export-records-slots');

    // Select-all is offered and acts on the visible rows.
    fireEvent.click(screen.getByTestId('export-slots-select-all'));
    mockSendMessage.mockClear();
    fireEvent.click(screen.getByTestId('export-submit'));
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EXPORT_PACKAGE' }),
      );
    });
    let call = mockSendMessage.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'EXPORT_PACKAGE',
    );
    // Clearing all means every slot is excluded — the scope must say so, not
    // silently export them anyway.
    expect((call?.[0] as { payload: { scope: { excludedSlotIds?: number[] } } })
      .payload.scope.excludedSlotIds).toContain(1);

    // Toggling back includes it again.
    fireEvent.click(screen.getByTestId('export-slots-select-all'));
    mockSendMessage.mockClear();
    fireEvent.click(screen.getByTestId('export-submit'));
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EXPORT_PACKAGE' }),
      );
    });
    call = mockSendMessage.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'EXPORT_PACKAGE',
    );
    expect((call?.[0] as { payload: { scope: { excludedSlotIds?: number[] } } })
      .payload.scope.excludedSlotIds).toEqual([]);
  });

  it('filters the list by search and by Match Type (需求1)', async () => {
    await openExportSection();
    fireEvent.click(screen.getByTestId('export-dim-slots'));
    await screen.findByTestId('export-records-slots');

    const search = screen.getByTestId('export-slots-search');
    fireEvent.change(search, { target: { value: 'nothing-matches-this' } });
    expect(screen.getByTestId('export-slots-empty')).toBeTruthy();

    fireEvent.change(search, { target: { value: 's1.example' } });
    expect(screen.getByTestId('export-slots-row-1')).toBeTruthy();

    // The Match Type filter is a real control with both modes available.
    const filter = screen.getByTestId('export-slots-match-type') as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: 'regex' } });
    expect(screen.getByTestId('export-slots-empty')).toBeTruthy();
    fireEvent.change(filter, { target: { value: 'exact' } });
    expect(screen.getByTestId('export-slots-row-1')).toBeTruthy();
  });

  it('shows the settings PARTS with their values, each independently selectable (需求4)', async () => {
    await openExportSection();

    fireEvent.click(screen.getByTestId('export-dim-settings'));
    await screen.findByTestId('export-records-settings');

    const box = screen.getByTestId('export-settings-values');
    expect(box.textContent).toMatch(/Match settings/);
    expect(box.textContent).toMatch(/Tab ID exists, Rule check match, Priority tabId/);
    expect(box.textContent).toMatch(/Switch direction/);
    expect(box.textContent).toMatch(/Auto-bind \(global\)/);
    // Per-slot strategy from the machine's own slot (mock slot 1 = 'inherit').
    expect(screen.getByTestId('export-setting-slot:1:strategy').textContent).toMatch(/inherit/);

    // Deselecting ONE part must send exactly that part as excluded.
    fireEvent.click(screen.getByTestId('export-part-switchDirection'));
    mockSendMessage.mockClear();
    fireEvent.click(screen.getByTestId('export-submit'));
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'EXPORT_PACKAGE' }),
      );
    });
    const call = mockSendMessage.mock.calls.find(
      (c) => (c[0] as { action?: string }).action === 'EXPORT_PACKAGE',
    );
    const scope = (call?.[0] as { payload: { scope: { excludedSettingIds?: string[] } } }).payload.scope;
    expect(scope.excludedSettingIds).toEqual(['switchDirection']);
  });

  it('shows the slot NUMBER before the title, and never repeats it (T19-C label)', async () => {
    await openExportSection('S1');
    fireEvent.click(screen.getByTestId('export-dim-slots'));
    await screen.findByTestId('export-records-slots');
    const row = await screen.findByTestId('export-slots-row-1');
    expect(within(row).getByText('Slot 1 — S1')).toBeTruthy();
  });

  it('does not repeat the number when a title already IS the placeholder', async () => {
    // The label helper only skipped a FALSY title, so a title that happens to
    // equal the placeholder produced "Slot 1 — Slot 1". It uses the same
    // exact-equality rule as the import row.
    await openExportSection('Slot 1');
    fireEvent.click(screen.getByTestId('export-dim-slots'));
    await screen.findByTestId('export-records-slots');
    const row = await screen.findByTestId('export-slots-row-1');
    expect(within(row).getByText('Slot 1')).toBeTruthy();
  });

  it('shows the bare number for an untitled slot', async () => {
    await openExportSection('');
    fireEvent.click(screen.getByTestId('export-dim-slots'));
    await screen.findByTestId('export-records-slots');
    const row = await screen.findByTestId('export-slots-row-1');
    expect(within(row).getByText('Slot 1')).toBeTruthy();
  });
});