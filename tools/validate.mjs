import { load, findMissing, findWarnings } from './lib.mjs';

const data = load();
const missing = findMissing(data);
const warn = findWarnings(data);

console.log(`\n  ${data.topics.length} topic(s), ${Object.keys(data.dictionary).length} dictionary entries, ${Object.keys(data.forms).length} inflected forms\n`);

if (missing.length) {
  console.log(`  MISSING (${missing.length}) — these words are not tappable:`);
  for (const m of missing) console.log(`   ${String(m.count).padStart(3)}x  ${m.token.padEnd(22)} ${m.where.join(', ')}`);
} else {
  console.log('  ✓ every word in every dialogue resolves to a dictionary entry');
}

if (warn.length) {
  console.log(`\n  WARNINGS (${warn.length}):`);
  for (const w of warn.slice(0, 80)) console.log('   - ' + w);
  if (warn.length > 80) console.log(`   … and ${warn.length - 80} more`);
}
console.log('');
process.exit(missing.length ? 1 : 0);
