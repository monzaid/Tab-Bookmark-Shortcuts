/*
 * Strip comments from source BEFORE matching specifiers/classes.
 *
 * THE single source for this step: two guards used to re-spell the same
 * line-comment/block-comment regex, so one semantic had two spellings that could
 * drift apart.
 *
 * Why a state machine and not that regex: the regex form also matched a double
 * slash INSIDE a string, then dropped the rest of the line. A line like
 *   const p = 'https://x'; import { A } from '@ui/evil';
 * lost everything from the slashes on, so the escaping import became invisible
 * to the guard - an escape from a guard that claims to reject the whole class.
 * This machine knows single quotes, double quotes and backticks (with escapes),
 * so a double slash in a string is content, not a comment.
 *
 * Behaviour is otherwise the SAME as the regex it replaces: a line comment keeps
 * its trailing newline, a block comment is removed whole (inner newlines
 * included) - so for valid source the stripped text differs only where a comment
 * delimiter sat inside a string. (An unterminated block comment also differs -
 * this machine drops the rest, the regex left it - but such source cannot
 * compile, so it is outside what the guards are ever handed.)
 */

/** Strip comments, string-aware. See the header note for why it is a machine. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'string' = 'code';
  let quote = '';

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (mode === 'code') {
      if (c === '/' && next === '*') { mode = 'block'; i += 2; continue; }
      if (c === '/' && next === '/') { mode = 'line'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = 'string'; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }

    if (mode === 'block') {
      // Removed WHOLE, inner newlines included - same as the replaced regex.
      if (c === '*' && next === '/') { mode = 'code'; i += 2; continue; }
      i += 1; continue;
    }

    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; }
      i += 1; continue;
    }

    // mode === 'string': keep everything, honour escapes so a backslash-quote
    // does not end the string early.
    out += c;
    if (c === '\\' && i + 1 < source.length) { out += source[i + 1]; i += 2; continue; }
    if (c === quote) mode = 'code';
    i += 1; continue;
  }

  return out;
}

/*
 * KNOWN ESCAPES (not covered here, stated so the limit is a checked fact; these
 * are NOT pinned as assertions - a "must leak" test would spec the defect):
 *   - a template literal's interpolation is treated as string content, so REAL
 *     code inside it is not seen.
 *   - a REGEX LITERAL's contents are treated as code, so a `//` inside one
 *     (e.g. /https?:\/\//, not rare in this repo) still starts a line comment and
 *     hides an import after it. Not caught by the old regex either.
 *   - any other form that needs real lexing rather than a text pass.
 * Covering these needs an actual parser - treat that as a signal to change
 * strategy, not a patch.
 */