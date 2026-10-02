/**
 * Pure helpers for the VS Code player (no `vscode` import), so they can be
 * unit-tested with plain Node (`node --test`).
 */

export interface TypingMeta {
  target: string;
  start?: string;
}

/**
 * Read `clm.typing` from a VS Code notebook cell's metadata.
 *
 * VS Code's built-in ipynb serializer nests the Jupyter cell metadata under
 * an extra `metadata` key (`cell.metadata.metadata.clm.typing`); older
 * versions used `cell.metadata.custom.metadata`. A bare `clm` key is accepted
 * too, for other serializers.
 */
export function readTyping(metadata: unknown): TypingMeta | null {
  const meta = asRecord(metadata);
  if (!meta) {
    return null;
  }
  const candidates = [
    asRecord(meta['metadata']),
    asRecord(asRecord(meta['custom'])?.['metadata']),
    meta
  ];
  for (const jupyter of candidates) {
    const typing = asRecord(asRecord(jupyter?.['clm'])?.['typing']);
    if (typing && typeof typing['target'] === 'string') {
      const start = typing['start'];
      return {
        target: normalizeEol(typing['target']),
        start: typeof start === 'string' ? normalizeEol(start) : undefined
      };
    }
  }
  return null;
}

function asRecord(x: unknown): Record<string, unknown> | undefined {
  return x !== null && typeof x === 'object'
    ? (x as Record<string, unknown>)
    : undefined;
}

/**
 * The planner works on `\n` text. Cell documents may use `\r\n` (VS Code's
 * `files.eol`), so every read from a document goes through this, and every
 * offset is converted to a line/character position on the normalized text.
 */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export interface LineCol {
  line: number;
  character: number;
}

/** Line/character position of `offset` in `\n`-separated `text`. */
export function lineCol(text: string, offset: number): LineCol {
  let line = 0;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: end - lineStart };
}

export interface TextEdit {
  from: number;
  to: number;
  text: string;
}

/**
 * The single replace that turns `current` into `desired` (common prefix and
 * suffix kept), or null if they are equal. The player usually types at the
 * cursor, so this is exactly the keystroke(s) since the last flush.
 */
export function minimalEdit(current: string, desired: string): TextEdit | null {
  if (current === desired) {
    return null;
  }
  let pre = 0;
  const max = Math.min(current.length, desired.length);
  while (pre < max && current[pre] === desired[pre]) {
    pre++;
  }
  let suf = 0;
  while (
    suf < max - pre &&
    current[current.length - 1 - suf] === desired[desired.length - 1 - suf]
  ) {
    suf++;
  }
  return {
    from: pre,
    to: current.length - suf,
    text: desired.slice(pre, desired.length - suf)
  };
}

/** Random step-mode delay for the next keystroke (ms). */
export function charDelay(
  charsPerSecond: number,
  jitter: number,
  lastInserted: string,
  random: () => number = Math.random
): number {
  const base = 1000 / Math.max(1, charsPerSecond);
  const j = Math.min(Math.max(jitter, 0), 0.95);
  let d = base * (1 + j * (random() * 2 - 1));
  if (lastInserted.startsWith('\n')) {
    d *= 3; // a beat after Enter
  } else if (lastInserted === ' ') {
    d *= 1.3;
  }
  return d;
}

/** Number of script keystrokes one hacker-mode key press types. */
export function hackerBurst(
  min: number,
  max: number,
  random: () => number = Math.random
): number {
  const lo = Math.max(1, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  return lo + Math.floor(random() * (hi - lo + 1));
}
