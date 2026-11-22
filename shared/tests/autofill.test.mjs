// The browser's autofill bar (key, card and address icons above the keyboard) redraws on every letter
// when it thinks a text box might be a form field. These make sure every text box in the app is
// created through textBox(), which turns that off, and that textBox() really does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// A very small stand-in for the browser, enough to build elements and record what is set on them.
globalThis.document = {
  createElement: (tag) => ({
    tag, attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    append() {},
  }),
};
const { textBox } = await import('../../potterychallenges/card.js');

test('textBox turns autofill off and tells password managers to leave it alone', () => {
  const t = textBox({ name: 'challenge_idea', rows: 3 });
  assert.equal(t.tag, 'textarea');
  assert.equal(t.attrs.autocomplete, 'off');
  assert.equal(t.attrs['data-lpignore'], 'true');
  assert.equal(t.attrs['data-1p-ignore'], 'true');
  assert.equal(t.attrs['data-bwignore'], 'true');
  assert.equal(t.attrs['data-form-type'], 'other');
  assert.equal(t.attrs.autocapitalize, 'sentences');
});

test('textBox gives the box the name it was asked for, and keeps the other settings', () => {
  const t = textBox({ name: 'project_notes', rows: 5, maxLength: 300 });
  assert.equal(t.name, 'project_notes');
  assert.equal(t.rows, 5);
  assert.equal(t.maxLength, 300);
});

const dir = new URL('../../potterychallenges/', import.meta.url);
const scripts = readdirSync(dir).filter((f) => f.endsWith('.js'));

test('no script builds a raw textarea; they all go through textBox()', () => {
  for (const f of scripts) {
    if (f === 'card.js') continue; // the helper itself
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.equal(/createElement\(\s*['"]textarea['"]/.test(src), false, `${f} creates a textarea directly`);
    assert.equal(/\bel\(\s*['"]textarea['"]/.test(src), false, `${f} builds a textarea with el(); use textBox()`);
  }
});

test('the names given to the text boxes are plain words, never address, card or password words', () => {
  const bad = /(address|addr|street|city|zip|postal|phone|email|card|cc-|cvc|pass|user|login|name$|^name)/i;
  let seen = 0;
  for (const f of scripts) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/textBox\(\{\s*name:\s*'([^']+)'/g)) {
      seen++;
      assert.equal(bad.test(m[1]), false, `"${m[1]}" in ${f} looks like a form field a browser might autofill`);
    }
  }
  assert.ok(seen >= 4, `expected at least 4 text boxes, found ${seen}`);
});

test('every text box has a different name', () => {
  const names = [];
  for (const f of scripts) for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/textBox\(\{\s*name:\s*'([^']+)'/g)) names.push(m[1]);
  assert.equal(new Set(names).size, names.length, names.join(', '));
});
