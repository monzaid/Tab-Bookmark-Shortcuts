import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup } from '@ui/shared/radio-group';

describe('T6: RadioGroup uses native fieldset/legend semantics', () => {
  const options = [
    { value: 'set', label: 'Custom Title' },
    { value: 'use-chain', label: 'Use chain', description: 'Falls back to the next layer.' },
  ];

  it('exposes the group to the accessibility tree with its legend as the name', () => {
    render(<RadioGroup label="Title source" name="t" value="set" options={options} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Title source' })).toBeTruthy();
  });

  it('calls onChange with the selected value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RadioGroup label="Title source" name="t" value="set" options={options} onChange={onChange} />);

    await user.click(screen.getByLabelText('Use chain'));
    expect(onChange).toHaveBeenCalledWith('use-chain');
  });

  it('associates an option description with its input via aria-describedby', () => {
    render(<RadioGroup label="Title source" name="t" value="set" options={options} onChange={vi.fn()} />);
    const input = screen.getByLabelText('Use chain');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('reflects the checked state from props', () => {
    render(<RadioGroup label="Title source" name="t" value="use-chain" options={options} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Use chain')).toBeChecked();
    expect(screen.getByLabelText('Custom Title')).not.toBeChecked();
  });
});