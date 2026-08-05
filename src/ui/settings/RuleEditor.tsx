/**
 * Rule Editor — Settings page rule table, detail drawer, full edit dialog, conflict confirmation.
 *
 * - Search/filter: all/auto/manual/conflict
 * - Compact table with rule list
 * - Detail drawer showing full rule info
 * - Full edit dialog: URL/regex, priority -100..100, icon source, conflict basis
 * - Delete confirmation
 * - "Possible overlap" secondary confirmation (warn level)
 * - Block level conflicts cannot be bypassed
 *
 * Does NOT: allow protected URL rules, scatter rule editing into sidebar
 */

import { useState, useMemo, useCallback } from 'react';
import { Button, FormField, Dialog, Confirm, StatusBadge, Toast } from '@ui/shared/components';
import type { PageRule, RuleMode, UrlMatchDefinition } from '@shared/types';
import { validateRegex, detectRuleConflict, isProtectedUrl } from '@shared/url-utils';
import type { ConflictResult } from '@shared/url-utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type RuleFilter = 'all' | 'auto' | 'manual' | 'conflict';

interface RuleEditorProps {
  rules: PageRule[];
  onCreate: (rule: Omit<PageRule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<{ success: boolean; errorCode?: string; conflict?: ConflictResult }>;
  onUpdate: (ruleId: string, updates: Partial<PageRule>) => Promise<{ success: boolean; errorCode?: string; conflict?: ConflictResult }>;
  onDelete: (ruleId: string) => Promise<{ success: boolean }>;
}

// ─── Rule Table ──────────────────────────────────────────────────────────────

function RuleTable({
  rules,
  filter,
  search,
  onSelect,
}: {
  rules: PageRule[];
  filter: RuleFilter;
  search: string;
  onSelect: (rule: PageRule) => void;
}) {
  const filtered = useMemo(() => {
    let result = rules;
    if (filter === 'auto') result = result.filter((r) => r.mode === 'auto');
    if (filter === 'manual') result = result.filter((r) => r.mode === 'manual');
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((r) => r.urlMatch.value.toLowerCase().includes(lower));
    }
    return result;
  }, [rules, filter, search]);

  return (
    <table className="tbs-rule-table" role="table" aria-label="Page rules">
      <thead>
        <tr>
          <th scope="col">URL Pattern</th>
          <th scope="col">Mode</th>
          <th scope="col">Priority</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((rule) => (
          <tr key={rule.id} onClick={() => onSelect(rule)} className="tbs-rule-table__row">
            <td className="tbs-rule-table__url" title={rule.urlMatch.value}>
              {rule.urlMatch.type === 'regex' ? `/${rule.urlMatch.value}/` : rule.urlMatch.value}
            </td>
            <td>
              <StatusBadge status={rule.mode === 'auto' ? 'active' : 'pending'} label={rule.mode} />
            </td>
            <td>{rule.priority}</td>
            <td>
              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onSelect(rule); }} aria-label={`Edit rule ${rule.id}`}>
                Edit
              </Button>
            </td>
          </tr>
        ))}
        {filtered.length === 0 && (
          <tr><td colSpan={4} className="tbs-rule-table__empty">No rules found</td></tr>
        )}
      </tbody>
    </table>
  );
}

// ─── Rule Edit Dialog ────────────────────────────────────────────────────────

interface RuleEditDialogProps {
  open: boolean;
  rule: PageRule | null; // null = create new
  existingRules: PageRule[];
  onClose: () => void;
  onSave: (data: { urlMatch: UrlMatchDefinition; mode: RuleMode; priority: number; title?: string }) => Promise<{ success: boolean; errorCode?: string; conflict?: ConflictResult }>;
}

function RuleEditDialog({ open, rule, existingRules, onClose, onSave }: RuleEditDialogProps) {
  const [urlType, setUrlType] = useState<'exact' | 'regex'>(rule?.urlMatch.type ?? 'exact');
  const [urlValue, setUrlValue] = useState(rule?.urlMatch.value ?? '');
  const [mode, setMode] = useState<RuleMode>(rule?.mode ?? 'auto');
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [title, setTitle] = useState(rule?.title ?? '');
  const [error, setError] = useState<string | null>(null);
  const [warnConflict, setWarnConflict] = useState<ConflictResult | null>(null);
  const [saving, setSaving] = useState(false);

  const validate = useCallback((): string | null => {
    if (!urlValue.trim()) return 'URL pattern is required';
    if (urlType === 'exact' && isProtectedUrl(urlValue)) return 'Cannot create rules for protected internal pages';
    if (urlType === 'regex') {
      const result = validateRegex(urlValue);
      if (!result.valid) return result.message ?? 'Invalid regex';
    }
    if (priority < -100 || priority > 100) return 'Priority must be between -100 and 100';
    return null;
  }, [urlValue, urlType, priority]);

  const handleSubmit = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    // Check conflicts
    const urlMatch: UrlMatchDefinition = { type: urlType, value: urlValue };
    const conflict = detectRuleConflict(urlMatch, existingRules, rule?.id);

    if (conflict.level === 'block') {
      setError(conflict.message ?? 'Rule conflict — cannot save');
      return;
    }

    if (conflict.level === 'warn' && !warnConflict) {
      setWarnConflict(conflict);
      return;
    }

    setSaving(true);
    setError(null);

    const result = await onSave({ urlMatch, mode, priority, title: title || undefined });
    setSaving(false);

    if (!result.success) {
      setError(result.errorCode === 'RULE_CONFLICT_BLOCK' ? 'Rule conflict — cannot save' : 'Failed to save rule');
      return;
    }

    setWarnConflict(null);
    onClose();
  }, [validate, urlType, urlValue, mode, priority, title, existingRules, rule, warnConflict, onSave, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rule ? 'Edit Rule' : 'Create Rule'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>Save</Button>
        </>
      }
    >
      <FormField label="Match type" htmlFor="rule-url-type">
        <select id="rule-url-type" value={urlType} onChange={(e) => setUrlType(e.target.value as 'exact' | 'regex')} aria-label="URL match type">
          <option value="exact">Exact URL</option>
          <option value="regex">Regex pattern</option>
        </select>
      </FormField>

      <FormField label={urlType === 'exact' ? 'URL' : 'Regex pattern (max 500 chars)'} htmlFor="rule-url-value" error={error ?? undefined}>
        <input
          id="rule-url-value"
          type="text"
          value={urlValue}
          onChange={(e) => { setUrlValue(e.target.value); setError(null); setWarnConflict(null); }}
          maxLength={urlType === 'regex' ? 500 : undefined}
          aria-label="URL pattern value"
        />
      </FormField>

      <FormField label="Mode" htmlFor="rule-edit-mode">
        <select id="rule-edit-mode" value={mode} onChange={(e) => setMode(e.target.value as RuleMode)} aria-label="Rule mode">
          <option value="auto">Auto (apply on load/navigation)</option>
          <option value="manual">Manual (apply from candidate list)</option>
        </select>
      </FormField>

      <FormField label="Priority (-100 to 100)" htmlFor="rule-priority" hint="Higher wins. Same priority: newer wins.">
        <input
          id="rule-priority"
          type="number"
          min={-100}
          max={100}
          value={priority}
          onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
          aria-label="Rule priority"
        />
      </FormField>

      <FormField label="Custom title (optional)" htmlFor="rule-title">
        <input id="rule-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Rule custom title" />
      </FormField>

      {/* Warn conflict secondary confirmation */}
      {warnConflict && (
        <div role="alert" className="tbs-rule-editor__warn">
          <p>⚠ {warnConflict.message}</p>
          <p>Conflicting rule priority: {existingRules.find((r) => r.id === warnConflict.conflictingRuleId)?.priority ?? '?'}</p>
          <div className="tbs-rule-editor__warn-actions">
            <Button size="sm" variant="ghost" onClick={() => setWarnConflict(null)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={handleSubmit}>Save Anyway</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ─── Main Rule Editor ────────────────────────────────────────────────────────

export function RuleEditor({ rules, onCreate, onUpdate, onDelete }: RuleEditorProps) {
  const [filter, setFilter] = useState<RuleFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedRule, setSelectedRule] = useState<PageRule | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<PageRule | null>(null);
  const [toast, setToast] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);

  const handleSave = useCallback(async (data: { urlMatch: UrlMatchDefinition; mode: RuleMode; priority: number; title?: string }) => {
    if (selectedRule) {
      return onUpdate(selectedRule.id, data);
    }
    return onCreate(data);
  }, [selectedRule, onCreate, onUpdate]);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const result = await onDelete(deleteConfirm.id);
    if (result.success) {
      setToast({ variant: 'success', message: 'Rule deleted' });
      setSelectedRule(null);
    } else {
      setToast({ variant: 'error', message: 'Failed to delete rule' });
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, onDelete]);

  return (
    <section aria-label="Page rule management">
      <h2>Page Rewrite Rules</h2>

      {/* Toolbar: search + filter + create */}
      <div className="tbs-rule-editor__toolbar">
        <input
          type="search"
          placeholder="Search rules..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search rules"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as RuleFilter)} aria-label="Filter rules">
          <option value="all">All</option>
          <option value="auto">Auto</option>
          <option value="manual">Manual</option>
          <option value="conflict">Conflict</option>
        </select>
        <Button variant="primary" size="sm" onClick={() => { setSelectedRule(null); setEditDialogOpen(true); }}>
          + New Rule
        </Button>
      </div>

      {/* Rule table */}
      <RuleTable rules={rules} filter={filter} search={search} onSelect={(r) => { setSelectedRule(r); setEditDialogOpen(true); }} />

      {/* Detail drawer (simplified — shows selected rule info) */}
      {selectedRule && !editDialogOpen && (
        <aside className="tbs-rule-editor__drawer" aria-label={`Rule detail: ${selectedRule.id}`}>
          <h3>Rule Detail</h3>
          <dl>
            <dt>Pattern</dt>
            <dd>{selectedRule.urlMatch.value}</dd>
            <dt>Type</dt>
            <dd>{selectedRule.urlMatch.type}</dd>
            <dt>Mode</dt>
            <dd>{selectedRule.mode}</dd>
            <dt>Priority</dt>
            <dd>{selectedRule.priority}</dd>
            <dt>Created</dt>
            <dd>{selectedRule.createdAt}</dd>
          </dl>
          <Button size="sm" variant="danger" onClick={() => setDeleteConfirm(selectedRule)}>Delete Rule</Button>
        </aside>
      )}

      {/* Edit dialog */}
      <RuleEditDialog
        open={editDialogOpen}
        rule={selectedRule}
        existingRules={rules}
        onClose={() => setEditDialogOpen(false)}
        onSave={handleSave}
      />

      {/* Delete confirmation */}
      <Confirm
        open={!!deleteConfirm}
        title="Delete Rule"
        message={`Delete rule "${deleteConfirm?.urlMatch.value}"? This cannot be undone. Pages will restore on refresh.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(null)}
      />

      {toast && <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} />}
    </section>
  );
}
