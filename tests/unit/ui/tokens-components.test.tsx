import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  colors,
  typography,
  density,
  breakpoints,
  animation,
  getLuminance,
  getContrastRatio,
  getReadableForeground,
  checkSlotColorContrast,
} from '@ui/shared/tokens';
import {
  Button,
  IconButton,
  Toast,
  Dialog,
  Confirm,
  FormField,
  StatusBadge,
  Tooltip,
} from '@ui/shared/components';

describe('T4: UI tokens, theme, accessible components', () => {
  describe('Happy path — light/dark rendering and accessibility', () => {
    it('should render alert toast with aria-live and accessible content', () => {
      render(<Toast variant="error" message="Something went wrong" />);
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(alert).toHaveTextContent('Something went wrong');
      // Status icon present (not color-only)
      expect(alert).toHaveTextContent('✕');
    });

    it('should render icon button with accessible name', () => {
      render(<IconButton aria-label="Close panel">✕</IconButton>);
      const btn = screen.getByRole('button', { name: 'Close panel' });
      expect(btn).toBeInTheDocument();
    });

    it('should render dialog with aria-modal and title', () => {
      render(
        <Dialog open={true} onClose={() => {}} title="Test Dialog">
          <p>Dialog content</p>
        </Dialog>
      );
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-label', 'Test Dialog');
      expect(screen.getByText('Dialog content')).toBeInTheDocument();
    });

    it('should close dialog on Escape key', () => {
      const onClose = vi.fn();
      render(
        <Dialog open={true} onClose={onClose} title="Escape Test">
          <p>Content</p>
        </Dialog>
      );
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should render button with focus-visible class support', () => {
      render(<Button variant="primary">Save</Button>);
      const btn = screen.getByRole('button', { name: 'Save' });
      expect(btn).toHaveClass('tbs-btn--primary');
    });

    it('should render form field with label association', () => {
      render(
        <FormField label="URL Pattern" htmlFor="url-input" hint="Enter a regex pattern">
          <input id="url-input" type="text" />
        </FormField>
      );
      const input = screen.getByLabelText('URL Pattern');
      expect(input).toBeInTheDocument();
      expect(screen.getByText('Enter a regex pattern')).toBeInTheDocument();
    });

    it('should render form field error with alert role', () => {
      render(
        <FormField label="Priority" htmlFor="priority-input" error="Must be -100 to 100">
          <input id="priority-input" type="number" />
        </FormField>
      );
      const error = screen.getByRole('alert');
      expect(error).toHaveTextContent('Must be -100 to 100');
    });

    it('should render status badge with icon and text (not color alone)', () => {
      render(<StatusBadge status="active" label="Connected" />);
      const badge = screen.getByText('Connected');
      expect(badge).toBeInTheDocument();
      // Icon is present alongside text
      const icon = badge.parentElement?.querySelector('.tbs-status-badge__icon');
      expect(icon).toHaveTextContent('●');
    });

    it('should render tooltip with role and content', () => {
      render(
        <Tooltip content="More info here">
          <button>Info</button>
        </Tooltip>
      );
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveTextContent('More info here');
    });
  });

  describe('Edge path — contrast calculation and reduced motion', () => {
    it('should calculate readable foreground for low-contrast slot color', () => {
      // Dark background should get white text
      const result = checkSlotColorContrast('#1a1a2e', '#ffffff');
      expect(result.passes).toBe(true);
      expect(result.suggestedText).toBe('#ffffff');
    });

    it('should suggest black text for light backgrounds', () => {
      const result = checkSlotColorContrast('#ffffff', '#ffffff');
      expect(result.passes).toBe(false); // white on white fails
      expect(result.suggestedText).toBe('#000000');
    });

    it('should calculate luminance correctly', () => {
      expect(getLuminance('#000000')).toBeCloseTo(0, 2);
      expect(getLuminance('#ffffff')).toBeCloseTo(1, 2);
    });

    it('should calculate contrast ratio for black on white', () => {
      const ratio = getContrastRatio('#000000', '#ffffff');
      expect(ratio).toBeCloseTo(21, 0);
    });

    it('should return correct foreground for mid-gray', () => {
      // #808080 has luminance ~0.216, above threshold → black text
      const fg = getReadableForeground('#808080');
      expect(fg).toBe('#000000');
    });

    it('should have reduced motion duration as 0ms', () => {
      expect(animation.reducedMotion.duration).toBe('0ms');
    });

    it('should have correct responsive breakpoints', () => {
      expect(breakpoints.narrow).toBe(300);
      expect(breakpoints.sidebar).toBe(320);
      expect(breakpoints.wide).toBe(440);
    });

    it('should have 10 slot colors in both themes', () => {
      expect(colors.light.slot).toHaveLength(10);
      expect(colors.dark.slot).toHaveLength(10);
    });

    it('should have density tokens for compact and comfortable', () => {
      expect(density.compact.rowHeight).toBe('32px');
      expect(density.comfortable.rowHeight).toBe('40px');
    });

    it('should have system font stack', () => {
      expect(typography.fontFamily).toContain('-apple-system');
      expect(typography.fontFamily).toContain('Segoe UI');
    });
  });

  describe('Confirm dialog', () => {
    it('should render confirm with danger variant', () => {
      render(
        <Confirm
          open={true}
          title="Delete Rule"
          message="This action cannot be undone."
          variant="danger"
          confirmLabel="Delete"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('tbs-btn--danger');
    });
  });
});
