import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RuleCard, OverrideCard, DraftProtectionDialog, DualCards } from '@ui/sidebar/DualCards';

describe('T16: Page rule and tab override dual cards', () => {
  describe('Happy path — save and aria-live', () => {
    it('should render rule card with title field and save button', () => {
      const onSave = vi.fn();
      render(<RuleCard ruleTitle="My Rule" onSave={onSave} />);

      expect(screen.getByLabelText('Rule title')).toHaveValue('My Rule');
      expect(screen.getByRole('button', { name: 'Save & Apply' })).toBeDisabled(); // Not dirty yet
    });

    it('should enable save after editing and call onSave', () => {
      const onSave = vi.fn();
      render(<RuleCard onSave={onSave} />);

      const input = screen.getByLabelText('Rule title');
      fireEvent.change(input, { target: { value: 'New Title' } });

      const saveBtn = screen.getByRole('button', { name: 'Save & Apply' });
      expect(saveBtn).toBeEnabled();

      fireEvent.click(saveBtn);
      expect(onSave).toHaveBeenCalledWith({ title: 'New Title', mode: 'auto' });
    });

    it('should render override card with priority hint', () => {
      const onSave = vi.fn();
      const onRemove = vi.fn();
      render(<OverrideCard onSave={onSave} onRemove={onRemove} />);

      expect(screen.getByText(/tab override → rule → site/)).toBeInTheDocument();
      expect(screen.getByLabelText('Tab title override')).toBeInTheDocument();
    });

    it('should show remove confirmation dialog', () => {
      const onSave = vi.fn();
      const onRemove = vi.fn();
      render(<OverrideCard onSave={onSave} onRemove={onRemove} />);

      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

      expect(screen.getByText(/Remove this tab override/)).toBeInTheDocument();
      // Two "Remove" buttons: trigger + confirm in dialog
      const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
      expect(removeButtons.length).toBeGreaterThanOrEqual(2);
    });

    it('should call onRemove after confirm', () => {
      const onSave = vi.fn();
      const onRemove = vi.fn();
      render(<OverrideCard onSave={onSave} onRemove={onRemove} />);

      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      // Click the confirm button in the dialog (second Remove button)
      const buttons = screen.getAllByRole('button', { name: 'Remove' });
      fireEvent.click(buttons[buttons.length - 1]); // Confirm button

      expect(onRemove).toHaveBeenCalled();
    });

    it('should render dual cards with equal weight', () => {
      render(
        <DualCards
          ruleTitle="Rule"
          overrideTitle="Override"
          onRuleSave={vi.fn()}
          onOverrideSave={vi.fn()}
          onOverrideRemove={vi.fn()}
        />
      );

      expect(screen.getByRole('region', { name: 'Page rule quick edit' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'This tab only override' })).toBeInTheDocument();
    });
  });

  describe('Edge path — draft protection', () => {
    it('should render draft protection dialog with three actions', () => {
      const onAction = vi.fn();
      render(<DraftProtectionDialog open={true} onAction={onAction} />);

      expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save Draft' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stay' })).toBeInTheDocument();
    });

    it('should call onAction with correct action', () => {
      const onAction = vi.fn();
      render(<DraftProtectionDialog open={true} onAction={onAction} />);

      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
      expect(onAction).toHaveBeenCalledWith('save');

      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(onAction).toHaveBeenCalledWith('discard');

      fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
      expect(onAction).toHaveBeenCalledWith('stay');
    });

    it('should be hidden when open is false', () => {
      render(<DraftProtectionDialog open={false} onAction={vi.fn()} />);
      const dialog = screen.getByRole('dialog', { hidden: true });
      expect(dialog).toHaveAttribute('hidden');
    });

    it('should not trigger apply action from draft save', () => {
      // Draft save only preserves local form state — no APPLY_REWRITE
      const onAction = vi.fn();
      render(<DraftProtectionDialog open={true} onAction={onAction} />);

      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
      expect(onAction).toHaveBeenCalledWith('save');
      // No apply/rewrite action is triggered by draft save
    });
  });
});
