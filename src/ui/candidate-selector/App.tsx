/**
 * Candidate Selector — cross-window grouped candidate list.
 *
 * - Grouped by window, current window first, left-to-right within group
 * - Slot/recovery candidates: click or Enter to switch immediately
 * - Manual rule candidates: select then "Apply to this page" confirm
 *
 * Does NOT: apply manual rule on single click
 */

import React, { useState, useCallback } from 'react';
import { Button } from '@ui/shared/components';
import type { TabCandidate } from '@shared/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CandidateSelectorProps {
  candidates: TabCandidate[];
  mode: 'slot' | 'manual-rule';
  onSwitch: (candidate: TabCandidate) => void;
  onApply?: (candidate: TabCandidate) => void;
  onClose: () => void;
}

// ─── Grouping Helper ─────────────────────────────────────────────────────────

interface WindowGroup {
  windowId: number;
  isCurrentWindow: boolean;
  tabs: TabCandidate[];
}

function groupByWindow(candidates: TabCandidate[]): WindowGroup[] {
  const groups = new Map<number, WindowGroup>();

  for (const c of candidates) {
    if (!groups.has(c.windowId)) {
      groups.set(c.windowId, {
        windowId: c.windowId,
        isCurrentWindow: c.isCurrentWindow,
        tabs: [],
      });
    }
    groups.get(c.windowId)!.tabs.push(c);
  }

  // Sort: current window first, then by windowId
  return Array.from(groups.values()).sort((a, b) => {
    if (a.isCurrentWindow && !b.isCurrentWindow) return -1;
    if (!a.isCurrentWindow && b.isCurrentWindow) return 1;
    return a.windowId - b.windowId;
  });
}

// ─── Candidate Selector Component ────────────────────────────────────────────

export function CandidateSelectorApp({ candidates, mode, onSwitch, onApply, onClose }: CandidateSelectorProps) {
  const [selected, setSelected] = useState<TabCandidate | null>(null);

  const groups = groupByWindow(candidates);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, candidate: TabCandidate) => {
    if (e.key === 'Enter') {
      if (mode === 'slot') {
        onSwitch(candidate);
      } else {
        setSelected(candidate);
      }
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }, [mode, onSwitch, onClose]);

  const handleApply = useCallback(() => {
    if (selected && onApply) {
      onApply(selected);
    }
  }, [selected, onApply]);

  return (
    <div role="dialog" aria-label="Candidate Selector" className="tbs-candidate-selector">
      <h2 className="tbs-candidate-selector__title">
        {mode === 'slot' ? 'Select Tab' : 'Apply Rule to Tab'}
      </h2>

      {candidates.length === 0 ? (
        <p className="tbs-candidate-selector__empty">No matching tabs found.</p>
      ) : (
        <div role="list" aria-label="Candidate tabs grouped by window">
          {groups.map((group) => (
            <div key={group.windowId} className="tbs-candidate-selector__group">
              <h3 className="tbs-candidate-selector__group-title">
                {group.isCurrentWindow ? 'Current Window' : `Window ${group.windowId}`}
              </h3>
              {group.tabs.map((candidate) => (
                <div
                  key={candidate.tabId}
                  role="listitem"
                  tabIndex={0}
                  className={`tbs-candidate-selector__item ${selected?.tabId === candidate.tabId ? 'tbs-candidate-selector__item--selected' : ''}`}
                  onClick={() => {
                    if (mode === 'slot') {
                      onSwitch(candidate);
                    } else {
                      setSelected(candidate);
                    }
                  }}
                  onKeyDown={(e) => handleKeyDown(e, candidate)}
                  aria-label={`${candidate.title} (${candidate.url})`}
                  aria-selected={selected?.tabId === candidate.tabId}
                >
                  <span className="tbs-candidate-selector__item-title">{candidate.title}</span>
                  <span className="tbs-candidate-selector__item-url">{candidate.url}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Manual rule: apply button */}
      {mode === 'manual-rule' && (
        <div className="tbs-candidate-selector__footer">
          <Button
            variant="primary"
            onClick={handleApply}
            disabled={!selected}
            aria-label="Apply rule to selected tab"
          >
            Apply to This Page
          </Button>
        </div>
      )}

      <div className="tbs-candidate-selector__footer">
        <Button variant="ghost" onClick={onClose} aria-label="Close candidate selector">
          Close
        </Button>
      </div>
    </div>
  );
}
