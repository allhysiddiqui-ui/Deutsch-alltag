import fs from 'node:fs';
import path from 'node:path';
import { ROOT, load, findMissing } from './lib.mjs';

const force = process.argv.includes('--force');
const p = (...a) => path.join(ROOT, ...a);

const data = load();
const missing = findMissing(data);

if (missing.length) {
  console.error(`\n  ${missing.length} untappable word(s) — every word in a dialogue needs a dictionary entry:\n`);
  for (const m of missing.slice(0, 60)) {
    console.error(`   ${String(m.count).padStart(3)}x  ${m.token.padEnd(22)} ${m.where[0]}`);
  }
  if (missing.length > 60) console.error(`   … and ${missing.length - 60} more`);
  console.error(`\n   JSON stub for the missing ones:\n`);
  console.error(missing.slice(0, 60).map((m) =>
    `  "${m.token}": {"lemma":"${m.token}","pos":"","en":"","ur":"","ex":{"de":"","en":"","ur":""}},`).join('\n'));
  if (!force) { console.error('\n  Build aborted. Add them, or run with --force.\n'); process.exit(1); }
  console.error('\n  --force: building anyway, those words will show "not in dictionary".\n');
}

const html = fs.readFileSync(p('src', 'app.html'), 'utf8');
const css = fs.readFileSync(p('src', 'app.css'), 'utf8');
const js = fs.readFileSync(p('src', 'app.js'), 'utf8');

// Inline as a JS literal: escape "<" so a "</script>" inside content can't break
// out, plus the two unicode line separators that are legal in JSON but not in JS.
const SEP = new RegExp(String.fromCharCode(0x2028) + '|' + String.fromCharCode(0x2029), 'g');
const json = JSON.stringify(data)
  .replace(/</g, '\\u003c')
  .replace(SEP, (c) => '\\u' + c.charCodeAt(0).toString(16));

const out = html
  .replace('/*__CSS__*/', () => css)
  .replace('/*__DATA__*/', () => `window.__DATA__=${json};`)
  .replace('/*__JS__*/', () => js);

fs.mkdirSync(p('dist'), { recursive: true });
fs.writeFileSync(p('dist', 'deutsch.html'), out, 'utf8'); // the file you copy around
fs.writeFileSync(p('dist', 'index.html'), out, 'utf8');   // so `npx surge ./dist` works
fs.writeFileSync(p('index.html'), out, 'utf8');           // served by GitHub Pages from the repo root
fs.writeFileSync(p('.nojekyll'), '');                     // tell GitHub Pages to serve files as-is (no Jekyll build)

const words = Object.keys(data.dictionary).length;
let subtopics = 0, subs = 0, dialogues = 0, lines = 0, rp = 0;
for (const t of data.topics)
  for (const s of t.subtopics || []) {
    subtopics++;
    for (const ss of s.subs || []) {
      subs++;
      for (const d of Object.values(ss.dialogues || {})) { dialogues++; lines += d.lines.length; }
      rp += Object.keys(ss.roleplay || {}).length;
    }
  }

console.log(`\n  dist/deutsch.html  ${(out.length / 1024).toFixed(0)} KB`);
console.log(`  ${data.topics.length} topic(s) · ${subtopics} subtopic(s) · ${subs} conversations · ${dialogues} dialogues · ${lines} lines · ${rp} roleplays · ${words} words`);
console.log(`  ${missing.length ? missing.length + ' unresolved word(s)' : 'every word resolves'}\n`);