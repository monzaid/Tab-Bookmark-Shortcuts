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
  it('renders the two title options with a native radio group', () => {
    renderEditor();
    expect(screen.getByRole('group', { name: 'Title source' })).toBeTruthy();
    expect(screen.getByLabelText('Custom Title')).toBeTruthy();
    expect(screen.getByLabelText('Use chain')).toBeTruthy();
  });

  it('does not render Clear when canClearChain is false', () => {
    renderEditor({ canClearChain: false });
    expect(screen.queryByText('Clear title')).toBeNull();
  });

  it('renders Clear when canClearChain is true', () => {
    renderEditor({ canClearChain: true });
    expect(screen.getByText('Clear title')).toBeTruthy();
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

  it('binds the Use chain note to the radio group via aria-describedby (CT3-f)', () => {
    renderEditor({ mode: { kind: 'use-chain' }, canClearChain: true });
    const group = screen.getByRole('group', { name: 'Title source' });
    expect(group.getAttribute('aria-describedby')).toContain('field-title-use-chain-hint');
  });

  it('renders the immediate-write marker always (DT12)', () => {
    renderEditor();
    expect(screen.getByText('Applies immediately')).toBeTruthy();
  });

  it('shows a masking note with the masked owners', () => {
    // A slot + rule both set; the override wins and masks them.
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
    expect(screen.getByText(/Overridden by/)).toBeTruthy();
  });

  it('renders the unknown site value as an em dash, not as empty (IMP-5)', () => {
    const chain = chainWith();
    renderEditor({ chain });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('calls onChange when switching mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ onChange, lastValue: 'Prev' });
    await user.click(screen.getByLabelText('Custom Title'));
    expect(onChange).toHaveBeenCalledWith({ kind: 'set', value: 'Prev' });
  });
});