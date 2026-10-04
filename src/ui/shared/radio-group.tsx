/**
 * RadioGroup — a natively-semantic radio group (CT3-a).
 *
 * Uses `<fieldset>` + `<legend>` rather than a `div[role="radiogroup"]` with an
 * `aria-label`, so the group is announced as a named group by assistive tech and
 * participates in native keyboard navigation (arrow keys within a fieldset of
 * same-`name` radios).
 */

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

export interface RadioGroupProps {
  /** Legend text — the group's accessible name. */
  label: string;
  /** Shared `name` for every radio in the group. */
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: RadioOption[];
  disabled?: boolean;
  /** Optional id of a node describing the whole group. */
  'aria-describedby'?: string;
  /**
   * Item 2.1: lay the options out in a single horizontal row (wrapping only when
   * the panel is too narrow) instead of stacking them one per line.
   */
  inline?: boolean;
}

export function RadioGroup({
  label,
  name,
  value,
  onChange,
  options,
  disabled = false,
  'aria-describedby': ariaDescribedBy,
  inline = false,
}: RadioGroupProps) {
  return (
    <fieldset
      className={`tbs-radio-group${inline ? ' tbs-radio-group--inline' : ''}`}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
    >
      <legend className="tbs-radio-group__legend">{label}</legend>
      {/* The wrapper exists so the inline layout can lay the OPTIONS out as a
          row while the legend stays on its own line (a bare flex row would put
          the legend inline with the choices). */}
      <div className="tbs-radio-group__options">
        {options.map((opt) => {
          const id = `${name}-${opt.value}`;
          const descId = opt.description ? `${id}-desc` : undefined;
          return (
            <div className="tbs-radio-group__option" key={opt.value}>
              <input
                type="radio"
                id={id}
                name={name}
                value={opt.value}
                checked={value === opt.value}
                onChange={() => { onChange(opt.value); }}
                aria-describedby={descId}
              />
              <label htmlFor={id}>{opt.label}</label>
              {opt.description && (
                <span id={descId} className="tbs-radio-group__description">
                  {opt.description}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}