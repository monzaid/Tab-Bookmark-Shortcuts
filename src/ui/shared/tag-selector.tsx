/**
 * TagSelector — multi-select the tags for ONE rule (G3/D-b).
 *
 * Deliberately a checkbox set rather than a chip expression input: this control
 * answers "which tags does this rule carry?" (a set membership question), while
 * `TagExpressionInput` answers "which rules match this expression?" (a query).
 * They are different questions, so they are different controls.
 *
 * It creates tags IN PLACE (D-b) but never OWNS the write: `onCreateTag` is the
 * parent's, so the one `TagService` path is preserved (A1/D-f). A created tag is
 * selected immediately — the user asked for it by name, so making them find it in
 * the list afterwards would be a pointless second step.
 *
 * Selection is by ID (C1): a rename therefore follows automatically, and nothing
 * here has to be told a name changed.
 *
 * ─── Why the list has a search and a cap ─────────────────────────────────────
 *
 * The table has NO cap (C3), so this list grew to whatever the install held. At
 * twenty tags the fieldset became a wall that pushed the rest of the rule form
 * off the screen, and finding one tag meant reading all of them. Two changes,
 * both from the same complaint:
 *
 *   - a SEARCH filters by name, so "which of these is `urgent`" is a word typed
 *     rather than a list scanned;
 *   - only the first ten are rendered, with the rest behind one disclosure whose
 *     label STATES THE COUNT. A bare "…" would leave the user unsure whether the
 *     tag they want is hidden, which is the whole question the control has to
 *     answer.
 *
 * The two work together rather than being redundant: the search is for a user who
 * knows the name, the disclosure for one browsing the table. Neither replaces the
 * other, which is the same reason the rules table keeps its text search and its
 * chip expression side by side (G6).
 *
 * ─── Why the SELECTION is repeated above the list ────────────────────────────
 *
 * Not decoration, and not redundancy: it is the fix for a state the filter and the
 * cap could produce together. With twenty-four tags, picking one that the first
 * ten do not include and then collapsing the disclosure left it selected and
 * INVISIBLE — no checked box on screen, and therefore no way to unselect it short
 * of finding it again. The same happened to every other selection the moment a
 * search was typed. The selected chips are rendered from the SELECTED IDS rather
 * than from the visible rows, so they cannot be scrolled, filtered or folded away.
 *
 * ─── The create flow, and where it now lives ─────────────────────────────────
 *
 * The create affordance is a row INSIDE the list (`+ New tag`), expanded in place
 * into a labelled form — the same position and the same progression the
 * expression filter's candidate tray uses, so "make a tag" is found in one place
 * across the app rather than in two shapes.
 *
 * It is still a FORM rather than the tray's one-line `Create tag "x"` row, because
 * a tag IS a colour pair here: this surface offers both colours (the tray cannot —
 * there is no picker in a filter bar), so a name-only row would produce tags that
 * had to be re-opened on the Tags page to look like anything. Both colours, the
 * shared palette, and a live preview, so a tag made here is the tag the Tags page
 * would have made.
 *
 * A search that matches nothing is NOT a dead end: the same row is offered with
 * the query already in the name field, which is what an empty result almost always
 * means when the user has typed a name.
 */
import { useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { TagDefinition } from '@shared/types';
import { TAG_NAME_MAX, TAG_LIST_DISPLAY_LIMIT, isTagNameValid, isTagColorValid } from '@shared/tags';
import { DEFAULT_TAG_APPEARANCE } from '@shared/export-package';
import { PRESET_BG_COLORS, PRESET_TEXT_COLORS, autoTextColor } from '@ui/components/IconEditor';
import { SearchField } from '@ui/shared/search-field';
import { Button } from '@ui/shared/components';

export interface TagSelectorProps {
  selectedTagIds: string[];
  availableTags: TagDefinition[];
  onChange: (tagIds: string[]) => void;
  /** Create a tag by name AND appearance, returning it (or null on failure). */
  onCreateTag: (appearance: { name: string; backgroundColor: string; textColor: string }) => Promise<TagDefinition | null>;
  disabled?: boolean;
  /** Overrides the group label where the surface needs different wording. */
  label?: string;
  /**
   * How the create form's four fields lay out.
   *
   * `stacked` (four rows) for the sidebar, which is a ~288px column: two columns
   * of a colour picker in that width is unusable. `grid` (two rows of two) for the
   * settings page, which has the width to put the pair of related controls (name +
   * preview, background + text) side by side.
   *
   * A prop rather than a media query because the two surfaces are BOTH narrow-ish
   * on the same screen; what differs is the container they are placed in, which CSS
   * cannot see from inside the component.
   */
  layout?: 'stacked' | 'grid';
}

/**
 * How many tags are listed before the rest go behind a disclosure, and the pair a
 * new tag starts from.
 *
 * Both from the SHARED layer: the limit because it describes this table (the
 * expression filter's candidate tray shows the same table and the same judgement),
 * and the appearance because "the default tag colour" must be one value — the Tags
 * page's form and the import's miss-filling use the same pair.
 */
const TAG_LIST_LIMIT = TAG_LIST_DISPLAY_LIMIT;

const NEW_TAG_DEFAULTS = DEFAULT_TAG_APPEARANCE;

/**
 * The tag as it will actually look: its name in its own text colour on its own
 * background.
 *
 * The SAME rendering the candidate tray uses (`TagAppearanceForm`'s preview), and
 * for the same reason: two colours are hard to judge apart, and a preview is the
 * only way to see the pair at once. The outline is load-bearing rather than
 * decorative — the form permits a light-on-light pair (it is the user's judgement
 * to make), and without it such a tag would be an invisible shape on a white row.
 */
function expandHex(value: string): string {
  return value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;
}

function TagSwatch({
  name,
  backgroundColor,
  textColor,
}: {
  name: string;
  backgroundColor: string;
  textColor: string;
}): React.JSX.Element {
  return (
    <span
      className="tbs-tag-selector__chip"
      style={{ backgroundColor, color: textColor }}
    >
      {name}
    </span>
  );
}

export function TagSelector({
  selectedTagIds,
  availableTags,
  onChange,
  onCreateTag,
  disabled = false,
  label = 'Tags',
  layout = 'grid',
}: TagSelectorProps): React.JSX.Element {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBg, setNewBg] = useState(NEW_TAG_DEFAULTS.backgroundColor);
  const [newText, setNewText] = useState(NEW_TAG_DEFAULTS.textColor);
  const [error, setError] = useState<string | null>(null);
  /**
   * "A create is in flight", as a REF rather than the `busy` state.
   *
   * `setBusy(true)` only lands on the next render, so a same-tick second dispatch
   * (double click, a second Enter) still sees `busy === false`. A ref is updated
   * synchronously, so it closes that window — which is the half of the duplicate-tag
   * fix that belongs to this component (the service's in-write dedupe is the other).
   */
  const submittingRef = useRef(false);
  /**
   * The result of the last create, announced in place.
   *
   * A separate channel from `error` because the two are shown differently (an error
   * is an alert, a success is a status) — and because the create form can succeed
   * while the form-level `error` stays untouched. The user asked for visible
   * confirmation of BOTH outcomes: the write closes a round trip to the service, and
   * without a cue "the form emptied itself" is the only signal that it worked.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Collapsed by default? No — expanded, because the control's primary job is
   * picking a tag and a collapsed picker would hide it behind a click (the trade
   * this component already rejected once). Collapsing is for a user who has
   * finished, so it is available and remembered for the session.
   */
  const [collapsed, setCollapsed] = useState(false);

  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(
    () => (trimmed === ''
      ? availableTags
      : availableTags.filter((t) => t.name.toLowerCase().includes(trimmed))),
    [availableTags, trimmed],
  );
  const hiddenCount = Math.max(0, matches.length - TAG_LIST_LIMIT);
  const shown = showAll ? matches : matches.slice(0, TAG_LIST_LIMIT);

  /**
   * The selected tags, resolved from the IDS rather than from `matches`.
   *
   * This is the whole point of the selected row above the list: `matches` is
   * whatever the search and the cap left visible, and a selection that is not in
   * it cannot be seen OR unchecked. Resolving against the full table means a
   * selected tag is always reachable, and a deleted one is simply absent (C9 —
   * nothing to show, no tombstone).
   */
  const selectedTags = useMemo(
    () => availableTags.filter((t) => selectedTagIds.includes(t.id)),
    [availableTags, selectedTagIds],
  );

  /** What the in-list create row would produce right now, for its own preview. */
  const draftName = newName.trim() === '' ? 'New tag' : newName.trim();

  /** Open the create form, seeded with the search — see the empty-result case. */
  const openCreate = (seed?: string): void => {
    setCreating(true);
    setError(null);
    if (seed !== undefined && seed.trim() !== '') setNewName(seed.trim());
  };

  const toggle = (id: string, checked: boolean): void => {
    // Order follows the table's order rather than click order, so the stored
    // list does not shuffle for reasons the user cannot see.
    const next = new Set(selectedTagIds);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(availableTags.filter((t) => next.has(t.id)).map((t) => t.id));
  };

  const submitNew = async (): Promise<void> => {
    const name = newName.trim();
    // Re-entrancy guard as a REF, not only the `busy` state: `setBusy(true)` does not
    // take effect until the next render, so two dispatches in the SAME tick (a
    // double click, a second Enter) both read `busy === false` and both create. The
    // service is now race-safe, so the second would be refused rather than
    // duplicated — but the user would still see a success and a duplicate error for
    // one click, and the guard is the half that belongs here.
    if (busy || submittingRef.current) return;
    submittingRef.current = true;
    // Mirrors the service's rules so an invalid value never reaches the write.
    // The SERVICE still validates (this control is not the boundary); this is so
    // the user reads the problem in the form rather than after a round trip.
    if (!isTagNameValid(name)) {
      setError(`Tag names must be 1-${String(TAG_NAME_MAX)} characters.`);
      return;
    }
    if (!isTagColorValid(newBg) || !isTagColorValid(newText)) {
      setError('Colours must be hex values, like #3366CC.');
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const created = await onCreateTag({ name, backgroundColor: newBg, textColor: newText });
      if (created) {
        // Select it immediately; the parent owns the write, we own the selection.
        onChange([...selectedTagIds, created.id]);
        // Reset, but stay OPEN: tagging a rule is often "and this one too", and
        // collapsing the form would make the second create a second discovery.
        setNewName('');
        setNewBg(NEW_TAG_DEFAULTS.backgroundColor);
        setNewText(NEW_TAG_DEFAULTS.textColor);
        // Spoken and shown: the form emptied itself, and without this the only
        // evidence that the write happened is that the fields went blank.
        setNotice(`Added “${name}”.`);
      } else {
        // The PARENT reported the reason (a duplicate name) by toast, but this
        // control owns the form the user is looking at, so it states the outcome
        // here too rather than leaving the fields silently unchanged.
        setError('That tag could not be created.');
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <fieldset className="tbs-form-field tbs-tag-selector" disabled={disabled}>
      {/* The legend carries the collapse control, because collapsing is about the
          whole field ("I am done choosing") — not about the list alone. */}
      <legend className="tbs-form-field__label tbs-tag-selector__legend">
        {label}
        <button
          type="button"
          className="tbs-tag-selector__collapse"
          data-testid="tag-selector-collapse"
          aria-expanded={!collapsed}
          onClick={() => { setCollapsed((v) => !v); }}
        >
          {collapsed
            ? `Show${selectedTagIds.length > 0 ? ` (${String(selectedTagIds.length)})` : ''}`
            : 'Hide'}
        </button>
      </legend>

      {/* COLLAPSED: the selection is still shown, because it is the one thing a
          collapsed control must keep visible — hiding it would leave the user
          unable to see (or change) what the rule carries. */}
      {collapsed ? (
        <div className="tbs-tag-selector__selected" role="group" aria-label="Selected tags">
          {selectedTags.length === 0 && (
            <span className="tbs-tag-selector__selected-empty">No tags selected</span>
          )}
          {selectedTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="tbs-tag-selector__pill"
              aria-label={`Remove ${tag.name}`}
              disabled={disabled}
              onClick={() => { toggle(tag.id, false); }}
            >
              <TagSwatch name={tag.name} backgroundColor={tag.backgroundColor} textColor={tag.textColor} />
              <span className="tbs-tag-selector__pill-x" aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {/* The SELECTED tags come FIRST — above the search and the list.
              They are resolved from the selected IDS, so nothing the search or the
              cap does can hide them (a selection the list filtered away would
              otherwise be uncheckedable), and reading them first answers "what does
              this rule carry" before "what could I add".
              They also used to sit BELOW the list; that is where the report said
              they should NOT be. */}
          {selectedTags.length > 0 && (
            <div className="tbs-tag-selector__selected" role="group" aria-label="Selected tags">
              {selectedTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="tbs-tag-selector__pill"
                  aria-label={`Remove ${tag.name}`}
                  disabled={disabled}
                  onClick={() => { toggle(tag.id, false); }}
                >
                  <TagSwatch name={tag.name} backgroundColor={tag.backgroundColor} textColor={tag.textColor} />
                  <span className="tbs-tag-selector__pill-x" aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          )}

          {/* The search sits above the list it narrows, matching every other list
              in the app (rules, dashboard, tags) rather than inventing a
              placement. */}
          {availableTags.length > 0 && (
            <div className="tbs-tag-selector__toolbar">
              <SearchField
                testId="tag-selector-search"
                placeholder="Search tags..."
                value={query}
                ariaLabel={`Search ${label}`}
                onChange={(next) => {
                  setQuery(next);
                  // A new search starts collapsed: the disclosure means "the rest
                  // of THIS list", so it must not carry over to a narrower one.
                  setShowAll(false);
                }}
              />
              <span className="tbs-tag-selector__count">
                {selectedTagIds.length > 0 ? `${String(selectedTagIds.length)} selected` : ''}
              </span>
            </div>
          )}

          <div className="tbs-tag-selector__list">
        {/* "No tags exist" and "the list is empty" are different facts, and only the
            first is worth a sentence. Without it the field is a blank row plus a
            `+ New tag` chip, which reads as a control that failed to load — the
            Tags page states the same case ("No tags yet…"), so this is the same
            disclosure rather than a new one. Only when there is no SEARCH, since a
            search that matches nothing already has its own answer (`+ New tag
            "query"`). */}
        {availableTags.length === 0 && query.trim() === '' && (
          <span className="tbs-tag-selector__empty" data-testid="tag-selector-empty">
            No tags yet — create one below.
          </span>
        )}
        {shown.map((tag) => (
          <label key={tag.id} className="tbs-tag-selector__option">
            <input
              type="checkbox"
              checked={selectedTagIds.includes(tag.id)}
              onChange={(e) => { toggle(tag.id, e.target.checked); }}
              disabled={disabled}
            />
            {' '}
            {/* The swatch shows the tag's REAL appearance (background AND text
                colour), which is what makes "a tag" the same object here as it is
                on the Tags page. A deleted reference keeps its chip (C7). */}
            <span
              className="tbs-tag-selector__swatch"
              style={{ backgroundColor: tag.backgroundColor, color: tag.textColor }}
              aria-hidden="true"
            />
            {tag.name}
          </label>
        ))}

        {/* The create row lives IN the list — last, where `+ New` belongs — rather
            than as a detached button under it. Same placement as the candidate
            tray's create row, so "make a tag" is in one place across the app.
            A search that matches nothing is offered the same way out, with the
            query already carried into the name field.

            Stays MOUNTED while the form is open and reports `aria-expanded`
            truthfully. It used to unmount (`!creating`) while declaring a constant
            `aria-expanded={false}` — so the control a screen reader heard as
            "New tag, collapsed" vanished the moment it was activated, and its
            expanded state was never announced. Keeping it also gives the form a
            "close" affordance in the place the user opened it. */}
        <button
          type="button"
          className="tbs-tag-selector__option tbs-tag-selector__option--add"
          data-testid="tag-selector-add"
          aria-expanded={creating}
          disabled={disabled}
          onClick={() => {
            if (creating) {
              setCreating(false);
              setError(null);
              setNotice(null);
              return;
            }
            openCreate(matches.length === 0 ? query : undefined);
          }}
        >
          <span aria-hidden="true">{creating ? '−' : '+'}</span>
          {/* The open-state label is NOT "Cancel new tag": the form below has its own
              Cancel carrying that exact accessible name, and two controls with one
              name is an ambiguity for a screen reader and for a test. This row
              COLLAPSES the form, which is what it says. */}
          {creating
            ? 'Close the new tag form'
            : matches.length === 0 && query.trim() !== ''
              ? `New tag “${query.trim()}”`
              : 'New tag'}
        </button>

        {/* The rest of the table, behind one control whose label states the count:
            the user needs to know whether the tag they want is IN there, and a bare
            ellipsis does not answer that. It sits INSIDE the chip row — the same
            place the candidate tray puts its own — so revealing the rest keeps the
            control one row rather than dropping it onto a line of its own. */}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="tbs-tag-selector__more"
            aria-expanded={showAll}
            onClick={() => { setShowAll((v) => !v); }}
          >
            {showAll ? 'Show less' : `… +${String(hiddenCount)} more`}
          </button>
        )}
          </div>
        </>
      )}

      {/* The expanded create form, under the list it belongs to. Opening it is the
          `+ New tag` row above, so the flow is "the row becomes a form" rather
          than "a second, detached button opens a panel somewhere else". */}
      {creating && (
        <div
          className={`tbs-tag-selector__new tbs-tag-selector__new--${layout}`}
          role="group"
          aria-label="New tag"
        >
          {/* Both outcomes are announced IN the form. The failure is an `alert`
              (interrupting, because the user must act); the success is a `status`
              (polite, because nothing is expected of them). */}
          {error && <p role="alert" className="tbs-form-error">{error}</p>}
          {notice && !error && (
            <p role="status" className="tbs-tag-selector__notice" data-testid="tag-selector-notice">{notice}</p>
          )}
          <div className="tbs-tag-selector__new-body">
            <label className="tbs-tag-selector__field">
              <span>Name</span>
              <input
                type="text"
                aria-label="New tag name"
                value={newName}
                maxLength={TAG_NAME_MAX}
                onChange={(e) => {
                  setNewName(e.target.value);
                  // The "Added “x”." line describes the PREVIOUS tag, and the user
                  // has just started typing the next one — leaving it up means the
                  // form shows a success message about something other than what is
                  // in the fields. Typing is the signal that the last one is done.
                  setNotice(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submitNew();
                  }
                }}
                disabled={disabled || busy}
                // Focused on open: the user came here to type a name, and opening
                // a form that then needs a click to start typing is a wasted step.
                autoFocus
              />
            </label>

            {/* The preview sits BESIDE the two colour controls, because it shows
                the pair together — which is the thing being chosen. */}
            <div className="tbs-tag-selector__preview">
              <span className="tbs-tag-selector__preview-label">Preview</span>
              <TagSwatch name={draftName} backgroundColor={newBg} textColor={newText} />
            </div>

            {/* Both colours, because a tag IS a colour pair — offering only a name
                here produced tags that had to be re-opened on the Tags page to look
                like anything. The palette is the SHARED one, in full: this surface
                used to slice it to four, so the same concept offered eight choices
                on the Tags page and four here, for no reason a user could see. */}
            <label className="tbs-tag-selector__field">
              <span>Background</span>
              <span className="tbs-tag-selector__colors">
                <input
                  type="color"
                  aria-label="New tag background color"
                  value={newBg.length === 4 ? expandHex(newBg) : newBg}
                  onChange={(e) => { setNewBg(e.currentTarget.value); }}
                  disabled={disabled || busy}
                  className="tbs-icon-editor__color-input"
                />
                {PRESET_BG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`tbs-icon-editor__swatch${newBg.toLowerCase() === c.toLowerCase() ? ' tbs-icon-editor__swatch--active' : ''}`}
                    style={{ background: c }}
                    onClick={() => { setNewBg(c); }}
                    aria-label={`Background color ${c}`}
                    disabled={disabled || busy}
                  />
                ))}
              </span>
            </label>

            <label className="tbs-tag-selector__field">
              <span>Text</span>
              <span className="tbs-tag-selector__colors">
                <input
                  type="color"
                  aria-label="New tag text color"
                  value={newText.length === 4 ? expandHex(newText) : newText}
                  onChange={(e) => { setNewText(e.currentTarget.value); }}
                  disabled={disabled || busy}
                  className="tbs-icon-editor__color-input"
                />
                {PRESET_TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`tbs-icon-editor__swatch${newText.toLowerCase() === c.toLowerCase() ? ' tbs-icon-editor__swatch--active' : ''}`}
                    style={{ background: c }}
                    onClick={() => { setNewText(c); }}
                    aria-label={`Text color ${c}`}
                    disabled={disabled || busy}
                  />
                ))}
              </span>
            </label>
          </div>

          <div className="tbs-tag-selector__new-actions">
            {/* The three actions are the SHARED `Button` component, in the same
                variants the Tags page uses (`ghost` for the helper and Cancel,
                `primary` for the one committing action).
                
                They used to be hand-rolled `<button>`s with their own
                `tbs-tag-selector__auto/__cancel/__create` classes, which gave the
                SAME three actions a different look here than on the Tags page —
                one form's Create was a filled button, the other's used the shared
                primary, and neither matched. Reusing the component is what makes
                "auto colour / cancel / submit" one visual language across every
                surface that asks the question. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setNewText(autoTextColor(newBg)); }}
              disabled={disabled || busy}
            >
              Auto text colour
            </Button>
            {/* Pushes the decision pair to the right edge, so it is grouped and
                separated from the helper rather than reading as a third action of
                equal rank. */}
            <span className="tbs-tag-selector__new-spacer" />
            <Button
              size="sm"
              variant="ghost"
              // Named for WHAT it cancels. A bare "Cancel" inside a rule form is
              // ambiguous to a screen reader and to a test: the form it is nested
              // in has its own Cancel, and the two do different things — one
              // abandons the new tag, the other abandons the whole rule.
              aria-label="Cancel new tag"
              onClick={() => {
                setCreating(false);
                setError(null);
                setNotice(null);
                setNewName('');
                // The background is what a colour is FOR here; "Auto" states what
                // it did rather than silently overriding the choice.
                setNewText(autoTextColor(newBg));
              }}
              disabled={disabled || busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              data-testid="tag-selector-create"
              onClick={() => { void submitNew(); }}
              disabled={disabled || busy || !isTagNameValid(newName)}
            >
              {/* The label states the pending state: the write is a round trip and
                  "Create" over a form that is not moving reads as a dead button. */}
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}