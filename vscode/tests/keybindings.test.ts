// Run with: node --test tests/*.test.ts
// Guards the armed-only keybindings in package.json, which are generated
// data and cannot be exercised by the integration suite (it cannot press
// real keys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

interface Binding {
  command: string;
  key: string;
  when?: string;
}

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
);
const bindings: Binding[] = pkg.contributes.keybindings;
const armed = bindings.filter(b => b.when?.includes('clmTyping.armed'));
const commandMode = bindings.filter(b => b.command === 'clmTyping.commandModeKey');

const PRINTABLE = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon',
  'Quote', 'Backquote', 'Comma', 'Period', 'Slash', 'IntlBackslash', 'Space'
];

test('every printable physical key is captured in command mode, plain and shifted', () => {
  const keys = new Set(commandMode.map(b => b.key));
  for (const code of PRINTABLE) {
    assert.ok(keys.has(`[${code}]`), `[${code}]`);
    assert.ok(keys.has(`shift+[${code}]`), `shift+[${code}]`);
  }
  for (const k of ['enter', 'backspace', 'delete']) {
    assert.ok(keys.has(k), k);
  }
});

test('command-mode bindings apply only while armed and outside text input', () => {
  for (const b of commandMode) {
    assert.equal(b.when, 'clmTyping.armed && notebookEditorFocused && !inputFocus', b.key);
  }
});

test('armed bindings never take a run chord or a Ctrl/Alt/Cmd key', () => {
  for (const b of armed) {
    if (b.command === 'clmTyping.disarm') {
      continue; // Esc
    }
    assert.doesNotMatch(b.key, /\b(ctrl|alt|cmd|meta|win)\+/, `${b.command} ${b.key}`);
    assert.notEqual(b.key, 'shift+enter');
  }
});
