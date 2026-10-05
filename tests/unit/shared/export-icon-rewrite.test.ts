/**
 * T5 — export-side icon rewriting.
 *
 * C2: export must dereference offloaded icons and send a BARE `local-icon:`
 * reference (never the retired `[local:…]` wrapper). C1: a recipe is carried as
 * a recipe (no bitmap). URL icons stay URLs.
 *
 * Q1=A simplification: `type:'template'` is judged directly from the IconSource
 * (background passes recipes through unrendered), so no "guess recipe from data
 * URI" reverse-engineering is needed.
 */
import { describe, it, expect } from 'vitest';
import type { SyncState, SlotDefinition, PageRule } from '@shared/types';
import { syncStateToPackage } from '@shared/export-package';

function slotWith(id: number, icon: SlotDefinition['uiMarker']['icon']): SlotDefinition {
  return {
    id,
    urlMatch: { type: 'exact', value: `https://s${String(id)}.example.com` },
    strategy: 'inherit',
    uiMarker: { icon },
    titleSnapshot: `S${String(id)}`,
    faviconSnapshot: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function stateWith(slots: SlotDefinition[], rules: PageRule[] = []): SyncState {
  return {
    configVersion: 3,
    matchSettings: { tabIdMode: 'exists', ruleCheckMode: 'match', priority: 'tabId' },
    switchDirection: 'next',
    autoBindGlobal: true,
    slots,
    rules,
  };
}

describe('T5: export-side icon rewrite', () => {
  it('rewrites the three icon kinds correctly (url / local-ref / recipe)', () => {
    const state = stateWith([
      slotWith(1, { type: 'url', value: 'https://icons.example.com/a.png' }),
      slotWith(3, { type: 'upload', value: 'data:image/png;base64,iVBORw0KGgo=' }),
      slotWith(5, { type: 'template', value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' }),
    ]);

    const pkg = syncStateToPackage(state, { slots: true });
    const byId = new Map((pkg.slots ?? []).map((s) => [s.id, s]));

    expect(byId.get(1)?.marker.icon).toEqual({ kind: 'url', url: 'https://icons.example.com/a.png' });

    const uploadIcon = byId.get(3)?.marker.icon;
    expect(uploadIcon?.kind).toBe('local-ref');
    expect(uploadIcon?.ref).toBe('local-icon:icon:slot-3');
    expect(uploadIcon?.ref?.startsWith('local-icon:')).toBe(true);

    const recipe = byId.get(5)?.marker.icon;
    expect(recipe).toEqual({ kind: 'recipe', bgColor: '#2563EB', text: 'A', textColor: '#FFFFFF' });

    expect(JSON.stringify(pkg)).not.toContain('[local:');
    expect(JSON.stringify(pkg)).not.toContain('data:image/png;base64');
  });

  it('derives the rule ref key from the rule id (`icon:${rule.id}`)', () => {
    const rule: PageRule = {
      id: 'rule-42',
      urlMatch: { type: 'exact', value: 'https://r.example.com' },
      priority: 0,
      favicon: { type: 'upload', value: 'data:image/png;base64,AAAA' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const pkg = syncStateToPackage(stateWith([], [rule]), { rules: true });
    expect(pkg.rules?.[0].favicon).toEqual({ kind: 'local-ref', ref: 'local-icon:icon:rule-42' });
  });

  it('carries no bitmap bytes and no wrapper anywhere in the package', () => {
    const state = stateWith([
      slotWith(2, { type: 'upload', value: 'data:image/webp;base64,BBBB' }),
    ]);
    const json = JSON.stringify(syncStateToPackage(state, { slots: true }));
    expect(json).not.toContain('data:image');
    expect(json).not.toContain('[local:');
  });
});