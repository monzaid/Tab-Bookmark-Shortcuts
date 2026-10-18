/**
 * The rule and reset undo entries replay the RIGHT message.
 *
 * `createUndoReplay` is the single dispatch every surface shares, so its new
 * branches are asserted directly here rather than through a component: the point of
 * each entry is the message it produces, and a component test would mostly re-prove
 * the rendering around it.
 *
 * Two properties are worth stating because they are easy to get wrong:
 *  - `rule-enabled` writes an ABSOLUTE value. A toggle-based replay would invert
 *    whatever the rule says at undo time, so an edit made in between would be
 *    overwritten the wrong way.
 *  - `rule-delete` carries the id, and a refusal is turned into a THROW so the host
 *    can report it. `addRule` dedupes by urlMatch, so a restore can legitimately
 *    fail when the user recreated the rule.
 */
import { describe, it, expect, vi } from 'vitest';
import { createUndoReplay } from '@ui/shared/undo-stack';
import type { UndoEntry } from '@ui/shared/undo-stack';
import type { PageRule } from '@shared/types';

const RULE: PageRule = {
  id: 'rule-1',
  urlMatch: { type: 'exact', value: 'https://example.com' },
  priority: 0,
  title: 'R',
  tagIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const clientEntry = (writes: unknown[]): UndoEntry => ({
  id: 'u1',
  replay: 'client',
  snapshot: { writes, affectedTabIds: [] },
  message: 'm',
  expiresAt: Date.now() + 5000,
}) as unknown as UndoEntry;

describe('the rule undo kinds replay the right writes', () => {
  it('rule-enabled writes the ABSOLUTE previous value, not a toggle', async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    await createUndoReplay(send)(clientEntry([{ kind: 'rule-enabled', ruleId: 'rule-1', enabled: true }]));

    // The value the rule HAD, written back as-is. An "invert current" instruction
    // would be a different payload and is exactly what this asserts against.
    expect(send).toHaveBeenCalledWith('UPDATE_RULE', { ruleId: 'rule-1', enabled: true });
  });

  it('rule-delete sends the SAME record, id included', async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    await createUndoReplay(send)(clientEntry([{ kind: 'rule-delete', rule: RULE }]));

    expect(send).toHaveBeenCalledWith('RESTORE_RULE', { rule: RULE });
  });

  it('rule-delete THROWS on a refused restore so the host can report why', async () => {
    const send = vi.fn().mockResolvedValue({
      result: { success: false, errorCode: 'ALREADY_EXISTS', message: 'A rule for https://example.com already exists, so the deleted rule was not restored.' },
    });
    const replay = createUndoReplay(send);

    // The message the user asked for: "已存在同 URL 规则，未恢复".
    await expect(replay(clientEntry([{ kind: 'rule-delete', rule: RULE }]))).rejects.toThrow(
      /already exists/,
    );
  });

  it('a batch of rule-deletes restores every rule', async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    await createUndoReplay(send)(
      clientEntry([
        { kind: 'rule-delete', rule: RULE },
        { kind: 'rule-delete', rule: { ...RULE, id: 'rule-2' } },
      ]),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 'RESTORE_RULE', { rule: { ...RULE, id: 'rule-2' } });
  });
});
