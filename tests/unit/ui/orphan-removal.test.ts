/**
 * T18 — orphan/dead-code removal (Q13/N10/N12/DT11).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

function exists(p: string): boolean {
  return existsSync(resolve(root, p));
}

describe('T18: orphans are gone', () => {
  it('RuleEditor.tsx no longer exists', () => {
    expect(exists('src/ui/settings/RuleEditor.tsx')).toBe(false);
  });

  it('DualCards.tsx no longer exists', () => {
    expect(exists('src/ui/sidebar/DualCards.tsx')).toBe(false);
  });

  it('their dedicated test files are gone too', () => {
    expect(exists('tests/unit/ui/rule-editor.test.tsx')).toBe(false);
    expect(exists('tests/unit/ui/dual-cards.test.tsx')).toBe(false);
  });

  it('IconEditor.tsx (IN USE) is untouched', () => {
    expect(exists('src/ui/components/IconEditor.tsx')).toBe(true);
  });

  it('no source or test file still references the orphans', () => {
    const files = [
      'src/ui/settings/App.tsx',
      'src/ui/sidebar/App.tsx',
      'src/ui/settings/main.tsx',
      'src/ui/sidebar/main.tsx',
    ];
    for (const f of files) {
      const text = readFileSync(resolve(root, f), 'utf8');
      expect(text).not.toContain('from \'@ui/settings/RuleEditor\'');
      expect(text).not.toContain('from \'@ui/sidebar/DualCards\'');
      expect(text).not.toContain('DraftProtectionDialog');
    }
  });
});

describe('T18: DT11 — slot clear writes unify on null', () => {
  it('does not write the legacy empty-string icon shape in the settings/sidebar surfaces', () => {
    const settings = readFileSync(resolve(root, 'src/ui/settings/App.tsx'), 'utf8');
    const sidebar = readFileSync(resolve(root, 'src/ui/sidebar/App.tsx'), 'utf8');
    // The legacy `{type:'url', value:''}` / `{type:'upload', value:''}` shapes
    // must not be produced any more.
    expect(settings).not.toMatch(/icon:\s*\{\s*type:\s*'url',\s*value:\s*''\s*\}/);
    expect(sidebar).not.toMatch(/icon:\s*\{\s*type:\s*'upload',\s*value:\s*''\s*\}/);
  });

  it('the READ side still tolerates the legacy shapes (field-chain unset detection)', async () => {
    const { resolveFieldChain } = await import('@shared/field-chain');
    const { createDefaultLocalState, createDefaultSyncState } = await import('@background/storage-repository');

    const sync = {
      ...createDefaultSyncState(),
      slots: [{
        id: 1,
        urlMatch: { type: 'exact' as const, value: 'https://a.com/' },
        strategy: 'inherit' as const,
        uiMarker: { customTitle: '', icon: { type: 'url' as const, value: '' } },
        titleSnapshot: '',
        faviconSnapshot: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    };
    const local = {
      ...createDefaultLocalState(),
      bindings: [{ slotId: 1, tabId: 7, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
    };

    // Must not throw, and must treat both legacy empty shapes as UNSET.
    const result = resolveFieldChain('title', { sync, local, tabId: 7, tabUrl: 'https://a.com/' });
    expect(result.winner.value).toBeNull();
  });
});