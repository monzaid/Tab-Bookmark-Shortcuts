/**
 * Review item 10 (root cause) — on a CREATE surface the title/icon input must be
 * REACHABLE.
 *
 * `RuleFormFields` hides the `Use chain` tab for `variant === 'create'` (item 7),
 * but a new rule's `titleMode` starts as `{ kind: 'use-chain' }`. The picker then
 * had no tab matching its selected value AND gated the text input behind
 * `mode.kind === 'set'`, so the field could never be typed into — every created
 * rule silently persisted without a title or icon.
 *
 * RED guard: pre-fix there is no "Custom title text" input at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleFormFields } from '@ui/shared/rule-form-fields';
import type { RuleFormFieldsProps } from '@ui/shared/rule-form-fields';
import { resolveFieldChain } from '@shared/field-chain';
import { createDefaultLocalState, createDefaultSyncState } from '@background/storage-repository';

function chains() {
  const sync = createDefaultSyncState();
  const local = createDefaultLocalState();
  const input = { sync, local, tabId: 1, tabUrl: 'https://a.com/' };
  return {
    title: resolveFieldChain('title', input),
    favicon: resolveFieldChain('favicon', input),
  };
}

function renderCreate(overrides: Partial<RuleFormFieldsProps> = {}) {
  const onChange = vi.fn();
  const c = chains();
  const props: RuleFormFieldsProps = {
    variant: 'create',
    value: {
      url: 'https://a.com/page',
      matchType: 'exact',
      titleMode: { kind: 'use-chain' },
      iconMode: { kind: 'use-chain' },
      priority: 0,
    },
    onChange,
    prefill: { url: '' },
    chain: c.title,
    titleChain: c.title,
    iconChain: c.favicon,
    baselineTitle: { mode: { kind: 'use-chain' } },
    baselineIcon: { mode: { kind: 'use-chain' } },
    onResetTitleEdit: vi.fn(),
    onResetIconEdit: vi.fn(),
    onClearTitle: vi.fn(),
    onClearIcon: vi.fn(),
    submitMode: { kind: 'immediate' },
    ...overrides,
  };
  return { ...render(<RuleFormFields {...props} />), onChange };
}

describe('item 10 — the title/icon field is typeable on a create surface', () => {
  it('renders the Custom title text input even though `Use chain` is hidden', () => {
    renderCreate();
    expect(screen.queryByRole('tab', { name: 'Use chain' })).toBeNull();
    // The input must exist: otherwise a rule can never be given a title.
    expect(screen.getByLabelText('Custom title text')).toBeTruthy();
  });

  it('typing emits a `set` mode so the title is actually persisted', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCreate();

    const input = screen.getByLabelText('Custom title text');
    // A single keystroke: the parent here is a spy (no re-render), so each
    // character is emitted separately. What matters is the MODE — before the
    // fix nothing was emitted at all because there was no input to type into.
    await user.type(input, 'F');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ titleMode: { kind: 'set', value: 'F' } }),
    );
  });

  it('renders the icon picker so the icon is typeable too', () => {
    renderCreate();
    // The icon tab strip is present with its own tabs, and no `Use chain` there.
    expect(screen.getByRole('tab', { name: 'Icon URL' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Use chain' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Icon URL' })).toBeTruthy();
  });

  it('keeps the tab strip value consistent with a visible tab', () => {
    renderCreate();
    // Every rendered tab must be selectable — a strip whose `value` matches no
    // tab would show no selection at all.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.some((t) => t.getAttribute('aria-selected') === 'true')).toBe(true);
  });
});