/**
 * Tag boolean-expression engine — AST, ITERATIVE parse, ITERATIVE evaluate,
 * plus entity resolution (A2/G4/G5/D1).
 *
 * Pure module (`src/shared`, no React/chrome): the settings page and the worker
 * both need to agree on what an expression means, so the meaning lives here
 * rather than in a component.
 *
 * WHY ITERATIVE, NOT RECURSIVE (D1/C8): a naive recursive-descent parser and a
 * naive recursive evaluator both consume stack proportional to nesting depth.
 * The expression has NO depth limit (C8), and the failure mode of running out of
 * stack is not a tidy error — it is a crash that takes the settings page with it.
 * So both passes use EXPLICIT stacks: depth is bounded by memory, not by the
 * call stack. 5000 nested operators are exercised in the tests for exactly this
 * reason.
 *
 * The variable space is TAGS ONLY (G6): no `field op value` shape is pre-built.
 */
import type { TagDefinition } from './types';

/** Citation of a tag at insertion time (D2) — the fallback when it is deleted. */
export interface ChipTagToken {
  kind: 'tag';
  tagId: string;
  /** The name as it read WHEN INSERTED. Shown if the tag is later deleted. */
  nameAtInsert: string;
  /** The colour at insert time, so a deleted chip still renders as it did. */
  backgroundColorAtInsert: string;
}

export type ChipToken =
  | ChipTagToken
  | { kind: 'op'; op: 'AND' | 'OR' | 'NOT' }
  | { kind: 'paren'; p: '(' | ')' };

/** The parsed tree. Shared contract — the UI renders FROM this, not from text. */
export type Node =
  | { kind: 'tag'; tagId: string; nameAtInsert: string }
  | { kind: 'not'; child: Node }
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'or'; left: Node; right: Node };

export type ParseFailure = 'EMPTY' | 'INCOMPLETE' | 'UNBALANCED' | 'ARITY';
export type ParseResult = { ok: true; ast: Node } | { ok: false; reason: ParseFailure };

/** What the UI needs to decide between "no filter", "paused", and "apply". */
export interface ExpressionEvaluation {
  /** `false` => DO NOT FILTER (C6 for incomplete, C7 for a missing reference). */
  applied: boolean;
  /** Meaningful only when `applied`; `true` while unapplied = "show everything". */
  matched: boolean;
  /** C7: ids the (complete) expression names that no longer exist. */
  missingTagIds: string[];
}

/** Outcome of one reduce step, or `null` when it succeeded. */
type ReduceError = ParseFailure | null;

/** Operator precedence: NOT > AND > OR (the classic boolean order). */
const PRECEDENCE: Record<'NOT' | 'AND' | 'OR', number> = { NOT: 3, AND: 2, OR: 1 };

/**
 * Convert a chip sequence to an AST using an iterative shunting-yard pass.
 *
 * The pass tracks what it EXPECTS next (an operand, or an operator): every
 * rejection below is a case where that expectation is violated, which is what
 * lets an incomplete expression be reported instead of silently mis-parsed.
 */
export function parse(chips: ChipToken[]): ParseResult {
  const nodes: Node[] = [];
  const ops: Array<'NOT' | 'AND' | 'OR' | '('> = [];
  let expectOperand = true;
  let sawAny = false;
  let error: ParseFailure | null = null;

  /** Pop one operator and fold it over the operand stack. */
  const reduce = (op: 'NOT' | 'AND' | 'OR'): ReduceError => {
    if (op === 'NOT') {
      if (nodes.length < 1) return 'ARITY';
      const child = nodes.pop() as Node;
      nodes.push({ kind: 'not', child });
      return null;
    }
    if (nodes.length < 2) return 'ARITY';
    const right = nodes.pop() as Node;
    const left = nodes.pop() as Node;
    nodes.push(op === 'AND' ? { kind: 'and', left, right } : { kind: 'or', left, right });
    return null;
  };

  for (const chip of chips) {
    sawAny = true;

    if (chip.kind === 'tag') {
      // A tag where an operator was expected means two operands with nothing
      // joining them ("a b") — arity, not a pair we can guess.
      if (!expectOperand) { error = 'ARITY'; break; }
      nodes.push({ kind: 'tag', tagId: chip.tagId, nameAtInsert: chip.nameAtInsert });
      expectOperand = false;
      continue;
    }

    if (chip.kind === 'paren') {
      if (chip.p === '(') {
        if (!expectOperand) { error = 'ARITY'; break; }
        ops.push('(');
        continue;
      }
      // ')': illegal mid-operand ("()" or "a AND )").
      if (expectOperand) { error = 'ARITY'; break; }
      let closed = false;
      while (ops.length > 0) {
        const top = ops.pop() as 'NOT' | 'AND' | 'OR' | '(';
        if (top === '(') { closed = true; break; }
        error = reduce(top);
        if (error) break;
      }
      if (error) break;
      if (!closed) { error = 'UNBALANCED'; break; }
      expectOperand = false;
      continue;
    }

    // Operator.
    if (chip.op === 'NOT') {
      // Prefix unary: it stands where an operand is expected.
      if (!expectOperand) { error = 'ARITY'; break; }
      ops.push('NOT');
      continue;
    }
    // Infix binary.
    if (expectOperand) { error = 'ARITY'; break; } // missing left operand
    const prec = PRECEDENCE[chip.op];
    while (ops.length > 0) {
      const top = ops[ops.length - 1];
      if (top === '(') break;
      if (PRECEDENCE[top] >= prec) {
        ops.pop();
        error = reduce(top);
        if (error) break;
      } else break;
    }
    if (error) break;
    ops.push(chip.op);
    expectOperand = true;
  }

  if (!error) {
    if (!sawAny) {
      error = 'EMPTY';
    } else if (expectOperand) {
      // Ran out of chips while an operand was still due: "a AND", "NOT", "(a".
      error = 'INCOMPLETE';
    } else {
      while (ops.length > 0) {
        const top = ops.pop() as 'NOT' | 'AND' | 'OR' | '(';
        if (top === '(') { error = 'UNBALANCED'; break; }
        error = reduce(top);
        if (error) break;
      }
      if (!error && nodes.length !== 1) error = 'ARITY';
    }
  }

  if (error) return { ok: false, reason: error };
  return { ok: true, ast: nodes[0] };
}

/**
 * Evaluate an AST against a rule's tag ids, with an EXPLICIT stack.
 *
 * A predicate is true when the rule CARRIES the referenced tag. The traversal
 * pushes each node once to expand and once to combine, so it never recurses.
 */
export function evaluate(ast: Node, ruleTagIds: ReadonlySet<string>): boolean {
  const work: Array<{ node: Node; expanded: boolean }> = [{ node: ast, expanded: false }];
  const values: boolean[] = [];

  while (work.length > 0) {
    const { node, expanded } = work.pop() as { node: Node; expanded: boolean };

    if (!expanded) {
      work.push({ node, expanded: true });
      switch (node.kind) {
        case 'tag':
          break;
        case 'not':
          work.push({ node: node.child, expanded: false });
          break;
        case 'and':
        case 'or':
          // Right first, then left: the stack pops left first, so left lands on
          // `values` before right and the combine step reads them in order.
          work.push({ node: node.right, expanded: false });
          work.push({ node: node.left, expanded: false });
          break;
      }
      continue;
    }

    switch (node.kind) {
      case 'tag':
        values.push(ruleTagIds.has(node.tagId));
        break;
      case 'not':
        values.push(!(values.pop() as boolean));
        break;
      case 'and': {
        const right = values.pop() as boolean;
        const left = values.pop() as boolean;
        values.push(left && right);
        break;
      }
      case 'or': {
        const right = values.pop() as boolean;
        const left = values.pop() as boolean;
        values.push(left || right);
        break;
      }
    }
  }

  return values[0];
}

/** Every tag id the AST references, gathered iteratively (no recursion). */
function collectTagIds(ast: Node): string[] {
  const ids: string[] = [];
  const work: Node[] = [ast];
  while (work.length > 0) {
    const node = work.pop() as Node;
    switch (node.kind) {
      case 'tag': ids.push(node.tagId); break;
      case 'not': work.push(node.child); break;
      case 'and':
      case 'or': work.push(node.left, node.right); break;
    }
  }
  return ids;
}

/**
 * C6 + C7: turn a chip sequence into a filtering decision.
 *
 *   parse fails                              => { applied:false } and NO names (C6)
 *   parse ok, but a referenced id is gone    => { applied:false, missingTagIds } (C7)
 *   parse ok, all references live            => { applied:true, matched }
 *
 * `matched:true` while unapplied is deliberate: "not applied" means EVERY rule
 * passes, and expressing that as a boolean here stops each consumer from
 * re-implementing "show everything" slightly differently.
 */
export function evaluateExpression(
  chips: ChipToken[],
  ruleTagIds: Set<string>,
  tags: TagDefinition[],
): ExpressionEvaluation {
  const parsed = parse(chips);
  if (!parsed.ok) {
    return { applied: false, matched: true, missingTagIds: [] };
  }

  const live = new Set(tags.map((t) => t.id));
  const missingTagIds = [...new Set(collectTagIds(parsed.ast))].filter((id) => !live.has(id));
  if (missingTagIds.length > 0) {
    return { applied: false, matched: true, missingTagIds };
  }

  return { applied: true, matched: evaluate(parsed.ast, ruleTagIds), missingTagIds: [] };
}

/**
 * D2: what a chip should read.
 *
 * A live tag shows its CURRENT name, so a rename is reflected immediately —
 * that is the payoff of rules storing ids rather than names (C1). A deleted tag
 * has no live name, so the insert-time name is shown. There is deliberately NO
 * tombstone record: the fallback is display state, not stored state (C9-③/P6).
 */
export function resolveChipDisplayName(chip: ChipToken, tags: TagDefinition[]): string {
  if (chip.kind === 'tag') {
    const live = tags.find((t) => t.id === chip.tagId);
    return live ? live.name : chip.nameAtInsert;
  }
  return chip.kind === 'op' ? chip.op : chip.p;
}