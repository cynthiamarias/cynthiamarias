// Usage: node tools/release.mjs 0.6 "What's new, in a few words"
// Stamps one version number everywhere it has to match, so a phone can never run a mix of
// old and new files: version.json, the VERSION line in app.js, and the ?v= on every script,
// stylesheet and import. Run it before every publish. shared/tests/release.test.mjs fails
// if anything is out of step.
import { readFileSync, writeFileSync } from 'node:fs';

const [version, whatsNew] = process.argv.slice(2);
if (!/^\d+\.\d+(\.\d+)?$/.test(version ?? '') || !whatsNew) {
  console.error('Usage: node tools/release.mjs 0.6 "What\'s new, in a few words"');
  process.exit(1);
}
const dir = new URL('../potterychallenges/', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const write = (f, s) => writeFileSync(new URL(f, dir), s);

// Relative imports: from './x.js' or './x.js?v=old' -> './x.js?v=new'
const stampImports = (s) => s.replace(/(from\s+')(\.\/[a-z]+\.js)(\?v=[\d.]+)?(')/g, `$1$2?v=${version}$4`);

for (const f of ['app.js', 'review.js', 'data.js', 'card.js', 'browse.js', 'logic.js', 'projects.js', 'image.js', 'create.js']) {
  let s = stampImports(read(f));
  if (f === 'app.js') {
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    s = s.replace(/const VERSION = \{[^\n]*\};/, `const VERSION = { number: '${version}', date: '${date}', whatsNew: ${JSON.stringify(whatsNew)} };`);
  }
  write(f, s);
}
write('index.html', read('index.html').replace(/((?:href|src)=")(styles\.css|app\.js)(\?v=[\d.]+)?(")/g, `$1$2?v=${version}$4`));
write('version.json', JSON.stringify({ version }) + '\n');
console.log(`Stamped version ${version}`);
