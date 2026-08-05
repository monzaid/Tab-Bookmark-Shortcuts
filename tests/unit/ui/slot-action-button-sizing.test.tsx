/**
 * Regression test: slot action button sizing spec.
 *
 * Spec (authoritative design):
 * - Save (💾) and More (⋯) buttons render at FULL / original `sm` size.
 * - Prev/next match buttons (⤺/↻) render at HALF the size of Save/More.
 *
 * Enforced via:
 * 1. Class assertions on the rendered buttons (robust in jsdom).
 * 2. Parsing the CSS sources to assert explicit size values and the 2:1
 *    ratio, plus a guard that no sidebar rule overrides button width/height
 *    except the dedicated match-btn rule (which would otherwise silently
 *    shrink Save/More again).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { SidebarApp } from '@ui/sidebar/App';

const mockSendMessage = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: vi.fn() },
  },
});

function stateResponse(overrides?: Record<string, unknown>) {
  return {
    result: {
      success: true,
      sync: {
        configVersion: 1,
        globalStrategy: 'B',
        slots: [
          {
            id: 1,
            urlMatch: { type: 'exact', value: 'https://example.com' },
            strategy: 'inherit',
            uiMarker: { customTitle: 'Example' },
            titleSnapshot: 'Example',
            faviconSnapshot: '',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        rules: [],
      },
      local: {
        bindings: [{ slotId: 1, tabId: 42, windowId: 1, boundAt: '2026-01-01T00:00:00Z' }],
        cycleCursors: [],
        lastSuccessSlotId: 1,
        recoverySessions: [],
        recoverySnapshots: [],
        tabOverrides: [],
        iconCache: {},
        diagnostics: [],
      },
      ...overrides,
    },
  };
}

// ─── CSS source parsing helpers ──────────────────────────────────────────────

const SIDEBAR_CSS_PATH = resolve(process.cwd(), 'src/ui/styles/sidebar.css');
const BASE_CSS_PATH = resolve(process.cwd(), 'src/ui/styles/base.css');

interface CssRule {
  selector: string;
  body: string;
}

function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    rules.push({ selector: match[1].trim(), body: match[2].trim() });
  }
  return rules;
}

function findRule(css: string, pred: (rule: CssRule) => boolean): CssRule {
  const rule = parseRules(css).find(pred);
  if (!rule) throw new Error('Expected CSS rule not found');
  return rule;
}

function declValue(body: string, prop: string): string | null {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
}

function px(value: string | null): number | null {
  if (!value) return null;
  const m = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? Number(m[1]) : null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Slot action button sizing (spec: ⤺/↻ = half of Save/More)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(stateResponse());
  });

  describe('rendered button classes', () => {
    it('Save (💾) uses full sm sizing and does NOT carry the half-size match-btn class', async () => {
      render(<SidebarApp />);
      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      const save = screen.getByRole('button', { name: 'Save current tab to slot 1' });
      expect(save.classList.contains('tbs-btn--sm')).toBe(true);
      expect(save.classList.contains('tbs-slot-row__match-btn')).toBe(false);
    });

    it('More (⋯) uses full sm icon-button sizing and does NOT carry the half-size match-btn class', async () => {
      render(<SidebarApp />);
      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      const more = screen.getByRole('button', { name: 'More options for slot 1' });
      expect(more.classList.contains('tbs-icon-btn--sm')).toBe(true);
      expect(more.classList.contains('tbs-slot-row__match-btn')).toBe(false);
    });

    it('prev/next match buttons (⤺/↻) DO carry the half-size match-btn class', async () => {
      render(<SidebarApp />);
      await waitFor(() => {
        expect(screen.getByText('Example')).toBeInTheDocument();
      });

      const names = [
        'Switch to previous matching tab for slot 1',
        'Switch to next matching tab for slot 1',
      ];
      for (const name of names) {
        const btn = screen.getByRole('button', { name });
        expect(btn.classList.contains('tbs-slot-row__match-btn')).toBe(true);
      }
    });
  });

  describe('CSS sizing rules', () => {
    const sidebarCss = readFileSync(SIDEBAR_CSS_PATH, 'utf8');
    const baseCss = readFileSync(BASE_CSS_PATH, 'utf8');

    it('match-btn rule pins ⤺/↻ to an explicit square box with no padding', () => {
      const matchRule = findRule(sidebarCss, (r) => r.selector.includes('tbs-slot-row__match-btn'));
      expect(declValue(matchRule.body, 'width')).toBe('12px');
      expect(declValue(matchRule.body, 'height')).toBe('12px');
      expect(declValue(matchRule.body, 'padding')).toBe('0');
    });

    it('match-btn height is exactly half of the full-size sm icon button height', () => {
      const matchRule = findRule(sidebarCss, (r) => r.selector.includes('tbs-slot-row__match-btn'));
      const iconBtnSm = findRule(baseCss, (r) => r.selector === '.tbs-icon-btn--sm');

      const matchHeight = px(declValue(matchRule.body, 'height'));
      const fullHeight = px(declValue(iconBtnSm.body, 'height'));

      expect(matchHeight).not.toBeNull();
      expect(fullHeight).not.toBeNull();
      expect(Number(fullHeight)).toBe(Number(matchHeight) * 2);
    });

    it('match-btn width is exactly half of the full-size sm icon button width', () => {
      const matchRule = findRule(sidebarCss, (r) => r.selector.includes('tbs-slot-row__match-btn'));
      const iconBtnSm = findRule(baseCss, (r) => r.selector === '.tbs-icon-btn--sm');

      const matchWidth = px(declValue(matchRule.body, 'width'));
      const fullWidth = px(declValue(iconBtnSm.body, 'width'));

      expect(matchWidth).not.toBeNull();
      expect(fullWidth).not.toBeNull();
      expect(Number(fullWidth)).toBe(Number(matchWidth) * 2);
    });

    it('Save/More keep their original sm sizing untouched in base.css', () => {
      const btnSm = findRule(baseCss, (r) => r.selector === '.tbs-btn--sm');
      expect(declValue(btnSm.body, 'padding')).toBe('4px 8px');
      expect(declValue(btnSm.body, 'font-size')).toBe('var(--font-size-sm)');

      const iconBtnSm = findRule(baseCss, (r) => r.selector === '.tbs-icon-btn--sm');
      expect(declValue(iconBtnSm.body, 'width')).toBe('24px');
      expect(declValue(iconBtnSm.body, 'height')).toBe('24px');
      expect(declValue(iconBtnSm.body, 'font-size')).toBe('12px');
    });

    it('no sidebar rule overrides button width/height except the match-btn rule', () => {
      const overrides = parseRules(sidebarCss).filter(
        (r) =>
          (r.selector.includes('tbs-btn') || r.selector.includes('tbs-icon-btn')) &&
          (declValue(r.body, 'width') !== null || declValue(r.body, 'height') !== null),
      );
      for (const rule of overrides) {
        expect(rule.selector).toContain('match-btn');
      }
    });
  });
});
