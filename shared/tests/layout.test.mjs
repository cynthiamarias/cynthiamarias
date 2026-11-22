// Guards against the "screen jumps while typing" bug coming back. A sheet that follows the keyboard,
// or a listener that reacts to the phone nudging the view, feeds back into the layout on every
// keystroke. These read the real files, so they fail if either idea is reintroduced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../../potterychallenges/${f}`, import.meta.url), 'utf8');
const css = read('styles.css');
const app = read('app.js');
const projects = read('projects.js');
const create = read('create.js');

// The text of one CSS rule, found by its selector, up to the closing brace.
const rule = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no CSS rule for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};

test('the sheet is never positioned by the keyboard height', () => {
  assert.equal(rule('dialog.sheet').includes('var(--kb)'), false, 'dialog.sheet must not use --kb');
  assert.equal(rule('dialog.sheet.top').includes('var(--kb)'), false);
  assert.equal(/dialog\.sheet[^{]*\{[^}]*--kb/.test(css), false, 'no sheet rule anywhere may use --kb');
});

test('a sheet with a text box is anchored to the top and sized to the visible area', () => {
  const r = rule('dialog.sheet.top');
  assert.ok(/margin:\s*8px auto auto/.test(r), 'top-anchored');
  assert.ok(r.includes('var(--vvh'), 'sized to the visible area, with a fallback');
});

test('the viewport tracker listens to resize only, never to scroll', () => {
  assert.equal(/visualViewport[^;]*addEventListener\(\s*['"]scroll['"]/.test(app), false);
  assert.equal(/vv\.addEventListener\(\s*['"]scroll['"]/.test(app), false, 'reacting to scroll made the layout jump');
  assert.ok(/vv\.addEventListener\(\s*['"]resize['"]/.test(app));
});

test('the viewport tracker ignores small changes and waits for the next frame', () => {
  assert.ok(/requestAnimationFrame/.test(app));
  assert.ok(/>=\s*30/.test(app), 'a 30 px threshold hides the predictive-text bar coming and going');
});

test('openSheet anchors any sheet that holds a text box to the top', () => {
  const m = projects.match(/const openSheet = [\s\S]*?\n  \};/);
  assert.ok(m, 'could not find openSheet');
  assert.ok(m[0].includes("classList.toggle('top'"));
  assert.ok(m[0].includes('textarea'));
});

test('the sheets that have a text box really do contain a textarea (so the rule above catches them)', () => {
  assert.ok(/textBox\(/.test(projects), 'the Done sheet has a notes box');
  assert.ok(/textBox\(/.test(create), 'the Create and Remix sheets have text boxes');
});

test('the toast and banners may still sit above the keyboard (they hold no text box)', () => {
  assert.ok(rule('.toast').includes('var(--kb)'));
});
