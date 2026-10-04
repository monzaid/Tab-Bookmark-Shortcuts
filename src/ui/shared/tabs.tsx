/**
 * Tabs — a small, natively-semantic tab strip (manual acceptance review).
 *
 * The review asked for the title/icon source pickers to become TABS rather than
 * radio groups. This primitive is the single implementation used by every
 * surface that offers a source picker, so the interaction (and its a11y wiring)
 * cannot diverge between them.
 *
 * Semantics follow the WAI-ARIA tabs pattern with a roving tabindex: only the
 * selected tab is in the tab order, and Arrow/Home/End move between tabs.
 */

import { useRef, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  /** Optional short badge rendered after the label (e.g. the winning tier). */
  badge?: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list (the group label). */
  label: string;
  /** Prefix for generated ids, so several strips can coexist on one page. */
  idPrefix: string;
  disabled?: boolean;
  /** Ids of nodes that describe the strip (e.g. the "Use chain" note). */
  ariaDescribedBy?: string;
  /** Panel content is rendered by the caller, keyed off `value`. */
  children?: ReactNode;
}

export function Tabs({ items, value, onChange, label, idPrefix, disabled = false, ariaDescribedBy, children }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = items.findIndex((item) => item.id === value);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else next = items.length - 1;
    const target = items[next];
    onChange(target.id);
    // Move focus with the selection (roving tabindex).
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${idPrefix}-tab-${target.id}`)}`)
      ?.focus();
  };

  return (
    <div className="tbs-tabs" data-tabs={idPrefix}>
      <div
        ref={listRef}
        className="tbs-tabs__list"
        role="tablist"
        aria-label={label}
        aria-describedby={ariaDescribedBy}
        onKeyDown={handleKeyDown}
      >
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              id={`${idPrefix}-tab-${item.id}`}
              type="button"
              role="tab"
              className={`tbs-tabs__tab${selected ? ' tbs-tabs__tab--active' : ''}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => { onChange(item.id); }}
              disabled={disabled}
            >
              {item.label}
              {item.badge && <span className="tbs-tabs__badge">{item.badge}</span>}
            </button>
          );
        })}
      </div>
      {children !== undefined && (
        <div
          className="tbs-tabs__panel"
          id={`${idPrefix}-panel-${value}`}
          role="tabpanel"
          aria-labelledby={`${idPrefix}-tab-${value}`}
          tabIndex={0}
        >
          {children}
        </div>
      )}
    </div>
  );
}