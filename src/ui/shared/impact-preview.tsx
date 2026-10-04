/**
 * ImpactPreview — "what will this change actually affect?" (review items 5.2 /
 * 6.2 / 6.3).
 *
 * The background computes the answer over the OPEN tabs (`GET_IMPACT_PREVIEW`);
 * this component only renders it. Two questions the copy must answer honestly:
 *
 * - how many tabs the pattern matches, and how many of those are OWNED by a
 *   higher tier (so the edit will not be the value the user ends up seeing);
 * - WHICH tabs those are — the first few inline, the rest behind an expander so
 *   the panel stays readable when a pattern matches dozens of tabs.
 */

import { useCallback, useEffect, useState } from 'react';
import { getMessageClient } from './message-client';
import type { ImpactPreview as ImpactPreviewResult } from '@shared/messages';

export type ImpactPreviewEntry = ImpactPreviewResult['entries'][number];
export type ImpactPreviewData = ImpactPreviewResult;

/** How many rows are listed before the expander (review item 5.2: "first 3"). */
const INLINE_LIMIT = 3;

/** The favicon variant has no `rule` tier to preview against. */
type ImpactField = 'title' | 'icon';

interface ImpactPreviewProps {
  /** The pattern to measure. An empty pattern means "nothing to preview". */
  urlMatch: { type: 'exact' | 'regex'; value: string } | null;
  /** The rule being edited, so its own (unsaved) value is not counted twice. */
  excludeRuleId?: string;
  field?: ImpactField;
  /** Start with the full list visible (DT9: a global config is at risk). */
  defaultExpanded?: boolean;
}

/**
 * Ask the background which open tabs a pattern matches.
 *
 * A failure degrades to `null` (no panel) rather than an error state: the
 * preview is advisory, and blocking the form on it would be worse than omitting
 * it. The request is NOT issued for an empty pattern, since it would match
 * everything and the number would be meaningless.
 */
export function useImpactPreview(
  urlMatch: { type: 'exact' | 'regex'; value: string } | null,
  excludeRuleId?: string,
): { data: ImpactPreviewData | null; loading: boolean } {
  const [data, setData] = useState<ImpactPreviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const pattern = urlMatch?.value.trim() ?? '';
  const type = urlMatch?.type ?? 'exact';

  useEffect(() => {
    if (!pattern) {
      setData(null);
      setLoading(false);
      return;
    }

    // A mutable token rather than a plain boolean: the flag is flipped by the
    // cleanup closure, which the compiler's control-flow analysis cannot see, so
    // a `let cancelled` would be narrowed to a constant and its guards reported
    // as dead code. An object property is re-widened after the `await`.
    const token = { cancelled: false };
    setLoading(true);

    void (async () => {
      try {
        const client = getMessageClient();
        // Raw pass-through: the panel reads the wire shape directly and degrades
        // to "no panel" on any failure, so the normalized ClientResult wrapper
        // (which would surface an error string we deliberately ignore) is not used.
        const raw = await client.sendRaw('GET_IMPACT_PREVIEW', {
          urlMatch: { type, value: pattern },
          ...(excludeRuleId ? { excludeRuleId } : {}),
          limit: 50,
        });
        if (token.cancelled) return;
        const result = (raw as { result?: { success?: boolean; preview?: ImpactPreviewData } } | null)?.result;
        setData(result?.success ? (result.preview ?? null) : null);
      } catch {
        if (!token.cancelled) setData(null);
      } finally {
        if (!token.cancelled) setLoading(false);
      }
    })();

    return () => { token.cancelled = true; };
  }, [pattern, type, excludeRuleId]);

  return { data, loading };
}

export function ImpactPreview({
  urlMatch,
  excludeRuleId,
  field = 'title',
  defaultExpanded = false,
}: ImpactPreviewProps) {
  const { data, loading } = useImpactPreview(urlMatch, excludeRuleId);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => { setExpanded((prev) => !prev); }, []);

  // Only the title dimension owns a `rule` tier that can be masked by an
  // override / slot; the icon picker has no rule tier to preview.
  const showMasking = field === 'title';

  if (loading && !data) {
    return <p className="tbs-impact" role="status">Checking which tabs match…</p>;
  }
  if (!data || !urlMatch?.value.trim()) return null;

  const hidden = data.entries.slice(INLINE_LIMIT);
  const visible = expanded ? data.entries : data.entries.slice(0, INLINE_LIMIT);

  return (
    <div className="tbs-impact" role="status">
      <p className="tbs-impact__summary">
        Matches <strong>{data.total}</strong> {data.total === 1 ? 'tab' : 'tabs'}
        {showMasking && data.masked > 0 && (
          <> · <strong>{data.masked}</strong> masked</>
        )}
      </p>

      {showMasking && data.masked > 0 && (
        <p className="tbs-impact__note">
          Masked tabs already have a page or slot setting, so this value will not be what you see there.
        </p>
      )}

      {data.total === 0 && (
        <p className="tbs-impact__note">No open tab matches this pattern right now.</p>
      )}

      {visible.length > 0 && (
        <ul className="tbs-impact__list">
          {visible.map((entry) => (
            <li key={entry.tabId} className="tbs-impact__item" data-masked={entry.masked ? 'true' : 'false'}>
              <span className="tbs-impact__badge">{entry.masked ? 'masked' : 'open'}</span>
              <span className="tbs-impact__label" title={entry.url}>{entry.label}</span>
              <span className="tbs-impact__url" title={entry.url}>{entry.url}</span>
            </li>
          ))}
        </ul>
      )}

      {!expanded && hidden.length > 0 && (
        <button type="button" className="tbs-impact__more" onClick={toggle}>
          …and {hidden.length} more (expand)
        </button>
      )}
      {expanded && data.entries.length > INLINE_LIMIT && (
        <button type="button" className="tbs-impact__more" onClick={toggle}>
          Show less
        </button>
      )}
    </div>
  );
}