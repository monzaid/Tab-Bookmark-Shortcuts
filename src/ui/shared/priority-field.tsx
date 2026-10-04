/**
 * PriorityField — the reusable rule-priority input.
 *
 * Extracted out of `RuleFormFields` (DT8) so the priority control has one
 * definition (range copy, clamping hint, id wiring) instead of being re-typed
 * per surface. The caller owns the value; this component never clamps or
 * parses beyond what the number input already guarantees.
 */

export interface PriorityFieldProps {
  value: number;
  onChange: (priority: number) => void;
  idPrefix: string;
  disabled?: boolean;
}

export function PriorityField({ value, onChange, idPrefix, disabled = false }: PriorityFieldProps) {
  const priorityId = `${idPrefix}-priority`;

  return (
    <div className="tbs-form-field">
      <label htmlFor={priorityId} className="tbs-form-field__label">Priority (-100 to 100)</label>
      <input
        id={priorityId}
        type="number"
        min={-100}
        max={100}
        value={value}
        onChange={(e) => { onChange(parseInt(e.target.value, 10) || 0); }}
        aria-describedby={`${priorityId}-hint`}
        disabled={disabled}
      />
      <span id={`${priorityId}-hint`} className="tbs-form-field__hint">Higher priority wins when several rules match.</span>
    </div>
  );
}