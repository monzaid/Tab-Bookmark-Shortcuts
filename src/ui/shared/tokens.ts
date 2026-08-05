/**
 * Design tokens for Tab Bookmark Shortcuts UI.
 * Semantic tokens for light/dark themes, spacing, typography, density,
 * responsive breakpoints, and reduced-motion support.
 */

// ─── Color Tokens ────────────────────────────────────────────────────────────

export const colors = {
  light: {
    // Backgrounds
    bgPrimary: '#ffffff',
    bgSecondary: '#f5f5f7',
    bgTertiary: '#e8e8ed',
    bgHover: '#f0f0f2',
    bgActive: '#e5e5ea',

    // Text
    textPrimary: '#1d1d1f',
    textSecondary: '#6e6e73',
    textTertiary: '#86868b',
    textInverse: '#ffffff',

    // Accent
    accentPrimary: '#0071e3',
    accentHover: '#0077ed',
    accentActive: '#006edb',
    accentText: '#ffffff',

    // Focus
    focusRing: '#0071e3',
    focusRingOffset: '#ffffff',

    // Status
    success: '#34c759',
    successBg: '#e8f9ed',
    warning: '#ff9500',
    warningBg: '#fff4e5',
    error: '#ff3b30',
    errorBg: '#ffe5e3',
    info: '#007aff',
    infoBg: '#e5f2ff',

    // Borders
    borderPrimary: '#d2d2d7',
    borderSecondary: '#e8e8ed',
    borderFocus: '#0071e3',

    // Slot palette (10 distinct colors for slot identification)
    slot: [
      '#007aff', // 1 - Blue
      '#34c759', // 2 - Green
      '#ff9500', // 3 - Orange
      '#ff3b30', // 4 - Red
      '#af52de', // 5 - Purple
      '#5ac8fa', // 6 - Teal
      '#ff2d55', // 7 - Pink
      '#ffcc00', // 8 - Yellow
      '#8e8e93', // 9 - Gray
      '#007aff', // 10 - Blue (repeat with different shade)
    ],
  },
  dark: {
    // Backgrounds
    bgPrimary: '#1c1c1e',
    bgSecondary: '#2c2c2e',
    bgTertiary: '#3a3a3c',
    bgHover: '#3a3a3c',
    bgActive: '#48484a',

    // Text
    textPrimary: '#f5f5f7',
    textSecondary: '#a1a1a6',
    textTertiary: '#86868b',
    textInverse: '#1d1d1f',

    // Accent
    accentPrimary: '#0a84ff',
    accentHover: '#409cff',
    accentActive: '#0060df',
    accentText: '#ffffff',

    // Focus
    focusRing: '#0a84ff',
    focusRingOffset: '#1c1c1e',

    // Status
    success: '#30d158',
    successBg: '#1a3a2a',
    warning: '#ff9f0a',
    warningBg: '#3a2e1a',
    error: '#ff453a',
    errorBg: '#3a1a1a',
    info: '#0a84ff',
    infoBg: '#1a2a3a',

    // Borders
    borderPrimary: '#48484a',
    borderSecondary: '#3a3a3c',
    borderFocus: '#0a84ff',

    // Slot palette (dark mode adjusted)
    slot: [
      '#0a84ff', // 1
      '#30d158', // 2
      '#ff9f0a', // 3
      '#ff453a', // 4
      '#bf5af2', // 5
      '#64d2ff', // 6
      '#ff375f', // 7
      '#ffd60a', // 8
      '#98989d', // 9
      '#0a84ff', // 10
    ],
  },
} as const;

export type ThemeMode = 'light' | 'dark';
export type ColorTokens = typeof colors.light;

// ─── Typography Tokens ───────────────────────────────────────────────────────

export const typography = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontSize: {
    xs: '11px',
    sm: '12px',
    md: '13px',
    lg: '15px',
    xl: '17px',
    xxl: '22px',
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
  },
} as const;

// ─── Spacing Tokens ──────────────────────────────────────────────────────────

export const spacing = {
  xxs: '2px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px',
  xxxl: '32px',
} as const;

// ─── Density Tokens ──────────────────────────────────────────────────────────

export const density = {
  compact: {
    rowHeight: '32px',
    padding: '4px 8px',
    gap: '4px',
  },
  comfortable: {
    rowHeight: '40px',
    padding: '8px 12px',
    gap: '8px',
  },
} as const;

// ─── Responsive Breakpoints ──────────────────────────────────────────────────

export const breakpoints = {
  /** Below 300px — minimal layout */
  narrow: 300,
  /** 320px — standard sidebar width */
  sidebar: 320,
  /** 440px and above — wide layout */
  wide: 440,
} as const;

// ─── Animation Tokens ────────────────────────────────────────────────────────

export const animation = {
  duration: {
    fast: '100ms',
    normal: '200ms',
    slow: '300ms',
  },
  easing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  },
  /** When prefers-reduced-motion: reduce, all durations become 0 */
  reducedMotion: {
    duration: '0ms',
  },
} as const;

// ─── Border Radius ───────────────────────────────────────────────────────────

export const radius = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  full: '9999px',
} as const;

// ─── Shadow ──────────────────────────────────────────────────────────────────

export const shadow = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 2px 8px rgba(0, 0, 0, 0.1)',
  lg: '0 4px 16px rgba(0, 0, 0, 0.15)',
} as const;

// ─── Z-Index ─────────────────────────────────────────────────────────────────

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  toast: 500,
  tooltip: 600,
} as const;

// ─── Contrast Utilities ──────────────────────────────────────────────────────

/**
 * Calculate relative luminance of a hex color.
 */
export function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors.
 */
export function getContrastRatio(fg: string, bg: string): number {
  const l1 = getLuminance(fg);
  const l2 = getLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determine readable foreground color (black or white) for a given background.
 */
export function getReadableForeground(bgHex: string): '#000000' | '#ffffff' {
  const luminance = getLuminance(bgHex);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

/**
 * Check if a slot color has sufficient contrast and return suggestion if not.
 * Does NOT block saving — only provides a warning/suggestion.
 */
export function checkSlotColorContrast(
  bgColor: string,
  textColor: string,
): { passes: boolean; ratio: number; suggestedText: '#000000' | '#ffffff' } {
  const ratio = getContrastRatio(textColor, bgColor);
  const suggestedText = getReadableForeground(bgColor);
  return {
    passes: ratio >= 4.5, // WCAG AA for normal text
    ratio: Math.round(ratio * 100) / 100,
    suggestedText,
  };
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16);
    const g = parseInt(cleaned[1] + cleaned[1], 16);
    const b = parseInt(cleaned[2] + cleaned[2], 16);
    return [r, g, b];
  }
  if (cleaned.length === 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return [r, g, b];
  }
  return null;
}
