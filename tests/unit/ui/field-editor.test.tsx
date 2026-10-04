/**
 * T11 — FieldEditor (S4a): mode model, ↺ vs Clear division of labour, derived
 * `dirty`, two-state `Use chain` note, a11y bindings.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldEditor } from '@ui/shared/field-editor';
import type { FieldEditorProps } from '@ui/shared/field-editor';
import { resolveFieldChain } from '@shared/field-chain';
import { createDefaultLocalState, createDefaultSyncState } from '@background/storage-repository';
import type { PageRule, SyncState } from '@shared/types';

function chainWith(ruleTitle?: string) {
  const sync: SyncState = {
    ...createDefaultSyncState(),
    rules: ruleTitle
      ? [{
          id: 'r1',
          urlMatch: { type: 'exact', value: 'https://a.com/' },
          priority: 0,
          title: ruleTitle,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } satisfies PageRule]
      : [],
  };
  return resolveFieldChain('title', { sync, local: createDefaultLocalState(), tabId: 1, tabUrl: 'https://a.com/' });
}

function renderEditor(overrides: Partial<FieldEditorProps> = {}) {
  const props: FieldEditorProps = {
    field: 'title',
    mode: { kind: 'use-chain' },
    onChange: vi.fn(),
    chain: chainWith(),
    baseline: { mode: { kind: 'use-chain' } },
    onResetEdit: vi.fn(),
    onClearChain: vi.fn(),
    submitMode: { kind: 'immediate' },
    ...overrides,
  };
  return { ...render(<FieldEditor {...props} />), props };
}

describe('T11: FieldEditor', () => {
  it('renders the two title options as a tab strip (review item 3.1)', () => {
    renderEditor();
    expect(screen.getByRole('tablist', { name: 'Title source' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Custom Title/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Use chain/ })).toBeTruthy();
  });

  it('does not render Clear when canClearChain is false', () => {
    renderEditor({ canClearChain: false });
    expect(screen.queryByText('Clear title')).toBeNull();
  });

  it('renders Clear when canClearChain is true', () => {
    renderEditor({ canClearChain: true });
    expect(screen.getByText('Clear title')).toBeTruthy();
  });

  /**
   * Review item 2 (round 6): the icon dimension printed the record summary TWICE.
   *
   * `FieldEditor` rendered its own `MaskedSummary` while `IconFieldEditor` — the
   * component it delegates the icon surface to — rendered another from the same
   * `chain.nodes`, so the identical list appeared twice in the Dashboard Edit
   * panel and in the New Global Page Rule dialog.
   */
  it('renders the icon record summary exactly once (review item 2)', () => {
    renderEditor({ field: 'icon', chain: chainWith('R') });
    // `IconChainLabel`-free assertion: count the summary panels, not the rows.
    expect(document.querySelectorAll('.tbs-masked')).toHaveLength(1);
  });

  it('renders the title record summary exactly once as well', () => {
    renderEditor({ field: 'title', chain: chainWith('R') });
    expect(document.querySelectorAll('.tbs-masked')).toHaveLength(1);
  });

  /**
   * Review item 1 (round 6): `↺` on the icon dimension appeared dead.
   *
   * `onResetEdit` restored the parent's `FieldMode` + `iconConfig`, but the
   * picker's own richer value (which tab, which sub-mode, the preview) lives in
   * local state that was never touched — so nothing visibly changed. Reset must
   * therefore also push the ORIGINAL picker value back and report it upward.
   */
  it('the icon ↺ restores the picker value and reports it to the parent', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onIconConfigChange = vi.fn();
    const onResetEdit = vi.fn();
    renderEditor({
      field: 'icon',
      chain: chainWith(),
      mode: { kind: 'set', value: 'https://changed.example/i.png' },
      iconConfig: undefined,
      baseline: { mode: { kind: 'set', value: 'https://original.example/i.png' } },
      onChange,
      onIconConfigChange,
      onResetEdit,
    });

    await user.click(screen.getByRole('button', { name: /Reset to the value this editor opened with/i }));

    // The parent learns the original value…
    expect(onChange).toHaveBeenCalledWith({ kind: 'set', value: 'https://original.example/i.png' });
    // …and the shared reset hook still runs.
    expect(onResetEdit).toHaveBeenCalledTimes(1);
  });

  it('the ↺ reset never writes storage (only onResetEdit fires)', async () => {
    const user = userEvent.setup();
    const onResetEdit = vi.fn();
    const onClearChain = vi.fn();
    renderEditor({
      mode: { kind: 'set', value: 'Changed' },
      baseline: { mode: { kind: 'set', value: 'Baseline' } },
      onResetEdit,
      onClearChain,
      canClearChain: true,
    });

    await user.click(screen.getByRole('button', { name: /Reset this edit/i }));
    expect(onResetEdit).toHaveBeenCalledTimes(1);
    expect(onClearChain).not.toHaveBeenCalled();
  });

  it('derives dirty from the baseline (DT12)', () => {
    const { container, unmount } = renderEditor({
      mode: { kind: 'set', value: 'Same' },
      baseline: { mode: { kind: 'set', value: 'Same' } },
    });
    expect((container.querySelector('.tbs-field-editor') as HTMLElement).dataset.dirty).toBe('false');
    unmount();

    const second = renderEditor({
      mode: { kind: 'set', value: 'Changed' },
      baseline: { mode: { kind: 'set', value: 'Same' } },
    });
    expect((second.container.querySelector('.tbs-field-editor') as HTMLElement).dataset.dirty).toBe('true');
  });

  it('shows the create-variant Use chain note when the layer cannot be cleared', () => {
    renderEditor({ canClearChain: false, mode: { kind: 'use-chain' } });
    expect(screen.getByText(/This field stays unset/)).toBeTruthy();
  });

  it('shows the edit-variant Use chain note when the layer can be cleared', () => {
    renderEditor({ canClearChain: true, mode: { kind: 'use-chain' } });
    expect(screen.getByText(/Clears this layer/)).toBeTruthy();
  });

  it('binds the Use chain note to the tab strip via aria-describedby (CT3-f)', () => {
    renderEditor({ mode: { kind: 'use-chain' }, canClearChain: true });
    const strip = screen.getByRole('tablist', { name: 'Title source' });
    expect(strip.getAttribute('aria-describedby')).toContain('field-title-use-chain-hint');
  });

  it('renders the immediate-write marker always (DT12)', () => {
    renderEditor();
    expect(screen.getByText('Applies immediately')).toBeTruthy();
  });

  it('lists every record that describes the tab, in plain language', () => {
    // An override AND a rule both carry a value for this tab.
    const sync: SyncState = {
      ...createDefaultSyncState(),
      rules: [{
        id: 'r1',
        urlMatch: { type: 'exact', value: 'https://a.com/' },
        priority: 0,
        title: 'R',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    };
    const local = {
      ...createDefaultLocalState(),
      tabOverrides: [{ tabId: 1, title: 'O', createdAt: '2026-01-01T00:00:00Z' }],
    };
    const chain = resolveFieldChain('title', { sync, local, tabId: 1, tabUrl: 'https://a.com/' });

    renderEditor({ chain });
    // Review item 5: the summary names how many records describe the tab and
    // lists them; a bare "Overridden by …" line is what it replaced.
    expect(screen.getByText(/records describe this tab/)).toBeTruthy();
    expect(document.querySelectorAll('.tbs-masked__item')).toHaveLength(2);
    // Review item 7: the badge alone ("Rule") is not enough — each row explains
    // WHAT that record is, so "which record is this" is answerable.
    expect(screen.getByText(/Set by a global page rule/)).toBeTruthy();
  });

  it('renders the unknown site value as an em dash, not as empty (IMP-5)', () => {
    const chain = chainWith();
    renderEditor({ chain });
    // The Use chain tier table lists every tier, so several `—` are expected.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('seeds the custom tab with lastValue when switching back (review item 3.1)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ onChange, lastValue: 'Prev' });
    await user.click(screen.getByRole('tab', { name: /Custom Title/ }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'set', value: 'Prev' });
  });

  it('lists every chain tier (including empty ones) under Use chain (review item 2)', () => {
    renderEditor({ mode: { kind: 'use-chain' } });
    for (const tier of ['override', 'slot', 'rule', 'site'] as const) {
      expect(document.querySelector(`[data-tier="${tier}"]`)).toBeTruthy();
    }
  });

  it('hides the Use chain tab when the surface has no chain (item 6.1)', () => {
    renderEditor({ allowUseChain: false });
    expect(screen.queryByRole('tab', { name: /Use chain/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Custom Title/ })).toBeTruthy();
  });
});