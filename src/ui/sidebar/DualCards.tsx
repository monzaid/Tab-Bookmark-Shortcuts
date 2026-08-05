/**
 * Page Rules & Tab Override Cards — dual-card quick edit in sidebar.
 *
 * - Equal visual weight for persistent page rule and tabId temporary override
 * - Basic title/icon/auto-manual fields, secondary icon source section
 * - Immediate save and apply
 * - Override relationship and removal hints
 * - Draft protection on context switch: save draft / discard / stay
 *
 * Does NOT: edit regex/priority/conflict in sidebar, drafts trigger rewrites
 */

import { useState } from 'react';
import { Button, FormField, Confirm } from '@ui/shared/components';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RuleCardState {
  title: string;
  iconValue: string;
  mode: 'auto' | 'manual';
  isDirty: boolean;
}

interface OverrideCardState {
  title: string;
  iconValue: string;
  isDirty: boolean;
}

type DraftAction = 'save' | 'discard' | 'stay';

// ─── Rule Card Component ─────────────────────────────────────────────────────

interface RuleCardProps {
  ruleTitle?: string;
  ruleMode?: 'auto' | 'manual';
  onSave: (data: { title?: string; mode?: 'auto' | 'manual' }) => void;
}

export function RuleCard({ ruleTitle, ruleMode = 'auto', onSave }: RuleCardProps) {
  const [state, setState] = useState<RuleCardState>({
    title: ruleTitle ?? '',
    iconValue: '',
    mode: ruleMode,
    isDirty: false,
  });

  const handleChange = (field: keyof RuleCardState, value: string) => {
    setState((prev) => ({ ...prev, [field]: value, isDirty: true }));
  };

  const handleSave = () => {
    onSave({ title: state.title || undefined, mode: state.mode });
    setState((prev) => ({ ...prev, isDirty: false }));
  };

  return (
    <section className="tbs-card tbs-card--rule" aria-label="Page rule quick edit">
      <h3 className="tbs-card__title">Page Rule</h3>
      <FormField label="Title" htmlFor="rule-title">
        <input
          id="rule-title"
          type="text"
          value={state.title}
          onChange={(e) => handleChange('title', e.target.value)}
          aria-label="Rule title"
        />
      </FormField>
      <FormField label="Mode" htmlFor="rule-mode">
        <select
          id="rule-mode"
          value={state.mode}
          onChange={(e) => handleChange('mode', e.target.value)}
          aria-label="Rule mode"
        >
          <option value="auto">Auto</option>
          <option value="manual">Manual</option>
        </select>
      </FormField>
      <p className="tbs-card__hint">Icon inherits from rule settings if not set here.</p>
      <Button size="sm" variant="primary" onClick={handleSave} disabled={!state.isDirty}>
        Save & Apply
      </Button>
    </section>
  );
}

// ─── Override Card Component ─────────────────────────────────────────────────

interface OverrideCardProps {
  overrideTitle?: string;
  onSave: (data: { title?: string }) => void;
  onRemove: () => void;
}

export function OverrideCard({ overrideTitle, onSave, onRemove }: OverrideCardProps) {
  const [state, setState] = useState<OverrideCardState>({
    title: overrideTitle ?? '',
    iconValue: '',
    isDirty: false,
  });
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  const handleChange = (value: string) => {
    setState((prev) => ({ ...prev, title: value, isDirty: true }));
  };

  const handleSave = () => {
    onSave({ title: state.title || undefined });
    setState((prev) => ({ ...prev, isDirty: false }));
  };

  return (
    <section className="tbs-card tbs-card--override" aria-label="This tab only override">
      <h3 className="tbs-card__title">This Tab Only</h3>
      <FormField label="Title override" htmlFor="override-title">
        <input
          id="override-title"
          type="text"
          value={state.title}
          onChange={(e) => handleChange(e.target.value)}
          aria-label="Tab title override"
        />
      </FormField>
      <p className="tbs-card__hint">
        Priority: tab override → rule → site. Removed on tab close.
      </p>
      <div className="tbs-card__actions">
        <Button size="sm" variant="primary" onClick={handleSave} disabled={!state.isDirty}>
          Save & Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowRemoveConfirm(true)}>
          Remove
        </Button>
      </div>
      <Confirm
        open={showRemoveConfirm}
        title="Remove Override"
        message="Remove this tab override? Refresh or navigate to restore natural state."
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => { onRemove(); setShowRemoveConfirm(false); }}
        onCancel={() => setShowRemoveConfirm(false)}
      />
    </section>
  );
}

// ─── Draft Protection Dialog ─────────────────────────────────────────────────

interface DraftDialogProps {
  open: boolean;
  onAction: (action: DraftAction) => void;
}

export function DraftProtectionDialog({ open, onAction }: DraftDialogProps) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Unsaved changes" className="tbs-draft-dialog" hidden={!open}>
      <p>You have unsaved changes.</p>
      <div className="tbs-draft-dialog__actions">
        <Button size="sm" variant="primary" onClick={() => onAction('save')}>Save Draft</Button>
        <Button size="sm" variant="danger" onClick={() => onAction('discard')}>Discard</Button>
        <Button size="sm" variant="ghost" onClick={() => onAction('stay')}>Stay</Button>
      </div>
    </div>
  );
}

// ─── Combined Cards Container ────────────────────────────────────────────────

interface DualCardsProps {
  ruleTitle?: string;
  ruleMode?: 'auto' | 'manual';
  overrideTitle?: string;
  onRuleSave: (data: { title?: string; mode?: 'auto' | 'manual' }) => void;
  onOverrideSave: (data: { title?: string }) => void;
  onOverrideRemove: () => void;
}

export function DualCards({
  ruleTitle,
  ruleMode,
  overrideTitle,
  onRuleSave,
  onOverrideSave,
  onOverrideRemove,
}: DualCardsProps) {
  return (
    <div className="tbs-dual-cards" aria-label="Quick edit cards">
      <RuleCard ruleTitle={ruleTitle} ruleMode={ruleMode} onSave={onRuleSave} />
      <OverrideCard overrideTitle={overrideTitle} onSave={onOverrideSave} onRemove={onOverrideRemove} />
    </div>
  );
}
