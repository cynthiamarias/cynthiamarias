// Fails if the app's version stamps are out of step. Fix with: node tools/release.mjs <version> "<what's new>"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../../potterychallenges/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const version = JSON.parse(read('version.json')).version;
const jsFiles = readdirSync(dir).filter((f) => f.endsWith('.js'));

test('version.json is a real version number', () => {
  assert.match(version, /^\d+\.\d+(\.\d+)?$/);
});

test('the VERSION line in app.js matches version.json', () => {
  const m = read('app.js').match(/const VERSION = \{ number: '([\d.]+)'/);
  assert.ok(m, 'could not find the VERSION line');
  assert.equal(m[1], version);
});

test('index.html loads the script and stylesheet with the current version stamp', () => {
  const html = read('index.html');
  assert.ok(html.includes(`src="app.js?v=${version}"`), 'app.js is not stamped');
  assert.ok(html.includes(`href="styles.css?v=${version}"`), 'styles.css is not stamped');
  assert.equal(/(?:src|href)="(?:app\.js|styles\.css)"/.test(html), false, 'an unstamped reference is left');
});

test('every relative import in every script carries the current version stamp', () => {
  let seen = 0;
  for (const f of jsFiles) {
    for (const m of read(f).matchAll(/from\s+'(\.\/[a-z]+\.js)(\?v=[\d.]+)?'/g)) {
      seen++;
      assert.equal(m[2], `?v=${version}`, `${f} imports ${m[1]} with ${m[2] ?? 'no stamp'}, expected ?v=${version}`);
    }
  }
  assert.ok(seen >= 6, `expected at least 6 relative imports, found ${seen}`);
});

test('a script file never imports another through a path the stamp check cannot see', () => {
  for (const f of jsFiles) {
    const s = read(f);
    assert.equal(/import\s+['"]\.\//.test(s), false, `${f} has a side-effect import with no stamp`);
    assert.equal(/import\(\s*['"]\.\//.test(s), false, `${f} has a dynamic import with no stamp`);
  }
});
