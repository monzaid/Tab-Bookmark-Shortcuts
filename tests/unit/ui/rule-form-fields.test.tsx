/**
 * T10 — RuleFormFields: create/edit equivalence + single-point `canClearChain`
 * derivation (IMP-7) + aria-describedby wiring (IMP-12 1–3).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleFormFields } from '@ui/shared/rule-form-fields';
import type { RuleFormFieldsProps, RuleFormVariant } from '@ui/shared/rule-form-fields';
import { resolveFieldChain } from '@shared/field-chain';
import { createDefaultLocalState, createDefaultSyncState } from '@background/storage-repository';

function chainFor() {
  const sync = createDefaultSyncState();
  const local = createDefaultLocalState();
  return resolveFieldChain('title', { sync, local, tabId: 1, tabUrl: 'https://a.com/' });
}

function iconChainFor() {
  const sync = createDefaultSyncState();
  const local = createDefaultLocalState();
  return resolveFieldChain('favicon', { sync, local, tabId: 1, tabUrl: 'https://a.com/' });
}

function renderFields(variant: RuleFormVariant, overrides: Partial<RuleFormFieldsProps> = {}) {
  const props: RuleFormFieldsProps = {
    variant,
    value: {
      url: 'https://a.com/page',
      matchType: 'exact',
      titleMode: { kind: 'use-chain' },
      iconMode: { kind: 'use-chain' },
      priority: 0,
    },
    onChange: vi.fn(),
    prefill: { url: 'https://a.com/page' },
    chain: chainFor(),
    titleChain: chainFor(),
    iconChain: iconChainFor(),
    baselineTitle: { mode: { kind: 'use-chain' } },
    baselineIcon: { mode: { kind: 'use-chain' } },
    onResetTitleEdit: vi.fn(),
    onResetIconEdit: vi.fn(),
    onClearTitle: vi.fn(),
    onClearIcon: vi.fn(),
    submitMode: { kind: 'immediate' },
    ...overrides,
  };
  return { ...render(<RuleFormFields {...props} />), props };
}

describe('T10: RuleFormFields', () => {
  it('renders the same field set in create and edit variants', () => {
    const fieldSet = () => [
    screen.getByRole('textbox', { name: /Match URL/ }),
    screen.getByRole('group', { name: 'Match Type' }),
    screen.getByRole('group', { name: 'Title source' }),
    screen.getByRole('group', { name: 'Icon source' }),
    screen.getByRole('spinbutton', { name: /Priority/ }),
  ];

    const { unmount } = renderFields('create');
    expect(fieldSet()).toHaveLength(5);
    unmount();

    renderFields('edit');
    expect(fieldSet()).toHaveLength(5);
  });

  it('does not render Clear in the create variant (canClearChain=false)', () => {
    renderFields('create');
    expect(screen.queryByLabelText('Clear title')).toBeNull();
    expect(screen.queryByLabelText('Clear icon')).toBeNull();
    expect(screen.queryByText('Clear title')).toBeNull();
    expect(screen.queryByText('Clear icon')).toBeNull();
  });

  it('renders Clear in the edit variant (canClearChain=true)', () => {
    renderFields('edit');
    expect(screen.getByText('Clear title')).toBeTruthy();
    expect(screen.getByText('Clear icon')).toBeTruthy();
  });

  it('never accepts a hand-written canClearChain prop (single derivation point)', () => {
    // The component's props type has no `canClearChain`; a stray value in the
    // props object is inert. This is the structural guarantee behind IMP-7.
    const props = {
      variant: 'create' as const,
      value: { url: 'x', matchType: 'exact' as const, titleMode: { kind: 'use-chain' as const }, iconMode: { kind: 'use-chain' as const }, priority: 0 },
      onChange: vi.fn(),
      prefill: { url: 'x' },
      chain: chainFor(),
      titleChain: chainFor(),
      iconChain: iconChainFor(),
      baselineTitle: { mode: { kind: 'use-chain' as const } },
      baselineIcon: { mode: { kind: 'use-chain' as const } },
      onResetTitleEdit: vi.fn(),
      onResetIconEdit: vi.fn(),
      onClearTitle: vi.fn(),
      onClearIcon: vi.fn(),
      submitMode: { kind: 'immediate' as const },
      canClearChain: true,
    };
     
    render(<RuleFormFields {...(props as unknown as RuleFormFieldsProps)} />);
    // Even with a stray `canClearChain: true`, create still hides Clear.
    expect(screen.queryByText('Clear title')).toBeNull();
  });

  it('shows inline validation for an invalid regex (create and edit alike)', async () => {
    for (const variant of ['create', 'edit'] as const) {
      const { unmount } = renderFields(variant, {
        value: {
          url: '(a+)+$',
          matchType: 'regex',
          titleMode: { kind: 'use-chain' },
          iconMode: { kind: 'use-chain' },
          priority: 0,
        },
      });
      expect(screen.getByRole('alert')).toBeTruthy();
      unmount();
    }
  });

  it('binds Match URL to its error node via aria-describedby (IMP-12)', () => {
    renderFields('edit', {
      value: {
        url: 'not a url',
        matchType: 'exact',
        titleMode: { kind: 'use-chain' },
        iconMode: { kind: 'use-chain' },
        priority: 0,
      },
    });
    const input = screen.getByRole('textbox', { name: /Match URL/ });
    expect(input.getAttribute('aria-describedby')).toBe('rf-url-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the converted regex as a hint for a wildcard input (E1-a)', () => {
    renderFields('edit', {
      value: {
        url: '*.example.com',
        matchType: 'regex',
        titleMode: { kind: 'use-chain' },
        iconMode: { kind: 'use-chain' },
        priority: 0,
      },
    });
    const hint = screen.getByText((_, el) => el?.id === 'rf-url-hint');
    expect(hint.textContent).toContain('Will be saved as:');
    expect(hint.textContent).toContain('\\.example\\.com');
  });

  it('resets the Match URL to the explicit prefill (DT1: no implicit fallback)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderFields('edit', { onChange });
    await user.click(screen.getByLabelText('Reset Match URL'));
    expect(onChange).toHaveBeenCalledWith({ url: 'https://a.com/page' });
  });

  it('renders the Enabled field only when the surface asks for it', () => {
    const { unmount } = renderFields('create');
    expect(screen.queryByText('Enabled')).toBeNull();
    unmount();
    renderFields('edit', { showEnabled: true });
    expect(screen.getByText('Enabled')).toBeTruthy();
  });
});