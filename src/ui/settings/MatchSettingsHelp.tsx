/**
 * In-app reference for the Global Matching Settings section.
 *
 * Every control in that section (Tab ID / Rule Check / Priority / Switch
 * Direction / Auto-bind) is documented here, including the four knob
 * combinations and which behaviour appears when a target cannot be resolved.
 *
 * Copy mirrors the shipped behaviour in `src/background/switch/**` — when the
 * resolver changes, this text must move with it.
 *
 * NOTE: no element below repeats a control's exact label text. The settings
 * tests look controls up by their precise text/aria-label, so a heading like
 * "Switch Direction" would become a second match and break those queries.
 */

const COMBINATIONS: ReadonlyArray<{ knobs: string; behaviour: string }> = [
  {
    knobs: 'Tab ID: Exists + Rule Check: Match',
    behaviour:
      'Both sources are considered; the chosen priority decides the winner. This is the default combination.',
  },
  {
    knobs: 'Tab ID: Exists + Rule Check: No match',
    behaviour:
      'Uses the slot\u2019s bound tab only. If it is still open it wins outright and the Match URL is ignored. ' +
      'If the bound tab is gone this is a "Tab Not Found" — it never falls back to a URL lookup.',
  },
  {
    knobs: 'Tab ID: No tab ID + Rule Check: Match',
    behaviour:
      'Ignores the bound tab entirely and resolves by Match URL / regex only. ' +
      'If no tab matches, this is a "Tab Not Found".',
  },
  {
    knobs: 'Tab ID: No tab ID + Rule Check: No match',
    behaviour:
      'Position mode: walks the tab strip of the current window by order. ' +
      'The bound tab is the anchor — if it is the active tab it steps to the neighbouring tab, ' +
      'otherwise it focuses the bound tab. A missing bound tab is a "Tab Not Found".',
  },
];

const PRIORITIES: ReadonlyArray<{ level: string; behaviour: string }> = [
  {
    level: 'Priority = Tab ID',
    behaviour:
      'The bound tab wins as long as it is still open (the Match URL is not re-checked). ' +
      'If it is gone, the first URL match is used instead.',
  },
  {
    level: 'Priority = Rule Check',
    behaviour:
      'The first URL match wins. The bound tab is used only when nothing matches the Match URL.',
  },
  {
    level: 'Priority = None',
    behaviour:
      'Strictest level: the bound tab must still be open AND its URL must still match. ' +
      'If either is untrue this is a "Tab Not Found" — no URL fallback is attempted.',
  },
];

export function MatchSettingsHelp() {
  return (
    <details className="tbs-settings__help">
      <summary>How these settings work</summary>

      <div className="tbs-settings__help-body">
        <p>
          The first knob decides whether the slot&apos;s bound tab may be used. The second decides
          whether tabs matching the slot&apos;s Match URL may be used. The third breaks the tie when
          both are available, and applies only to the first combination.
        </p>

        <h4>Knob combinations</h4>
        <dl className="tbs-settings__help-list">
          {COMBINATIONS.map((entry) => (
            <div key={entry.knobs}>
              <dt>{entry.knobs}</dt>
              <dd>{entry.behaviour}</dd>
            </div>
          ))}
        </dl>

        <h4>Tie-break priority (first combination only)</h4>
        <dl className="tbs-settings__help-list">
          {PRIORITIES.map((entry) => (
            <div key={entry.level}>
              <dt>{entry.level}</dt>
              <dd>{entry.behaviour}</dd>
            </div>
          ))}
        </dl>

        <h4>Direction of switching</h4>
        <p>
          Chooses the direction used by the &ldquo;Switch to next matching tab&rdquo; shortcut and by
          Position mode (the last combination). The arrow buttons in the sidebar always use their own
          explicit direction.
        </p>

        <h4>Auto-bind behaviour</h4>
        <p>
          When on, switching also records the target tab on the slot, so the next switch returns to it.
          This is the default for new slots; each slot can follow the global value, always bind, or
          never bind. The same option is offered in the Tab Not Found window.
        </p>

        <h4>When nothing can be resolved</h4>
        <p>
          A Tab Not Found window appears. It offers the saved URL (exact matches only), switching
          through the tabs that match the Match URL, and a do-nothing action. The window stays open
          while you browse, so you can click through the matches.
        </p>
      </div>
    </details>
  );
}