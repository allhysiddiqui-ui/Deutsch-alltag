import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => path.join(ROOT, ...a);

export const WORD_RE = /[A-Za-zÄÖÜäöüßéÉ]+(?:[’'\-][A-Za-zÄÖÜäöüß]+)*/g;
export const norm = (s) => String(s).toLowerCase().replace(/[^a-zäöüß'’\-]/g, '');

function readJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`Bad JSON in ${path.relative(ROOT, f)}\n  ${e.message}`);
  }
}

export function load() {
  // dictionary: every content/dictionary.*.json merged into one map
  const dictDir = p('content');
  const dictFiles = fs.readdirSync(dictDir).filter((f) => /^dictionary(\..+)?\.json$/.test(f)).sort();
  const dictionary = {};
  for (const f of dictFiles) {
    const obj = readJson(path.join(dictDir, f));
    for (const [k, v] of Object.entries(obj)) {
      if (dictionary[k]) console.warn(`  ! duplicate dictionary key "${k}" (${f})`);
      dictionary[k] = v;
    }
  }

  // topics: one folder per topic — _topic.json holds the meta + test,
  // every other *.json in the folder is one subtopic (ordered by "order").
  const topicDir = p('content', 'topics');
  const topics = [];
  if (fs.existsSync(topicDir)) {
    for (const name of fs.readdirSync(topicDir).sort()) {
      const dir = path.join(topicDir, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      if (!files.includes('_topic.json')) throw new Error(`content/topics/${name}: no _topic.json`);
      const topic = readJson(path.join(dir, '_topic.json'));
      topic.subtopics = files
        .filter((f) => f !== '_topic.json').sort()
        .map((f) => readJson(path.join(dir, f)))
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      topics.push(topic);
    }
    topics.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }

  // inflected form -> dictionary key
  const forms = {};
  for (const [k, e] of Object.entries(dictionary)) {
    const add = (f) => {
      const n = norm(f);
      if (!n || dictionary[n]) return;
      if (forms[n] && forms[n] !== k) return; // first wins, keeps lookups stable
      forms[n] = k;
    };
    add(e.lemma);
    (e.forms || []).forEach(add);
    if (e.plural) add(e.plural);
  }

  return { dictionary, forms, topics };
}

/** Every German word the app makes tappable must resolve. Returns [{token, count, where}]. */
export function findMissing({ dictionary, forms, topics }) {
  const miss = new Map();
  const seen = (tok, where) => {
    const n = norm(tok);
    if (!n) return;
    if (dictionary[n] || forms[n]) return;
    if (n.includes('-') && n.split('-').every((x) => !x || dictionary[x] || forms[x])) return;
    const rec = miss.get(n) || { token: n, count: 0, where: [] };
    rec.count++;
    if (rec.where.length < 3) rec.where.push(where);
    miss.set(n, rec);
  };
  const scan = (text, where, over) => {
    if (!text) return;
    for (const m of String(text).matchAll(WORD_RE)) {
      const t = m[0];
      if (over && (over[t] || over[norm(t)])) continue;
      seen(t, where);
    }
  };

  for (const t of topics) {
    for (const s of t.subtopics || []) {
      for (const [lv, d] of Object.entries(s.dialogues || {})) {
        (d.lines || []).forEach((l, i) => scan(l.de, `${t.id}/${s.id}/${lv}#${i + 1}`, l.w));
      }
      for (const [band, sc] of Object.entries(s.roleplay || {})) {
        for (const [id, n] of Object.entries(sc.nodes || {})) {
          scan(n.say, `${t.id}/${s.id}/rp-${band}/${id}`);
          scan(n.fallback, `${t.id}/${s.id}/rp-${band}/${id}`);
          (n.accept || []).forEach((a) => scan(a.reply, `${t.id}/${s.id}/rp-${band}/${id}`));
        }
      }
      for (const k of s.words || []) {
        if (!dictionary[k]) {
          const rec = miss.get(k) || { token: k, count: 0, where: [] };
          rec.count++; rec.where.push(`${t.id}/${s.id} words[]`);
          miss.set(k, rec);
        }
      }
    }
  }
  return [...miss.values()].sort((a, b) => b.count - a.count);
}

/** Softer checks that shouldn't block a build. */
export function findWarnings({ dictionary, topics }) {
  const w = [];
  for (const t of topics) {
    if (!t.test) w.push(`${t.id}: no test`);
    for (const s of t.subtopics || []) {
      for (const lv of ['A1', 'A2', 'B1', 'B2']) {
        const d = s.dialogues?.[lv];
        if (!d) { w.push(`${t.id}/${s.id}: missing level ${lv}`); continue; }
        if ((d.lines || []).length < 10) w.push(`${t.id}/${s.id}/${lv}: only ${d.lines.length} lines`);
        for (const [i, l] of d.lines.entries()) {
          if (!l.en || !l.ur) w.push(`${t.id}/${s.id}/${lv}#${i + 1}: missing en/ur`);
          if (!d.speakers?.[l.s]) w.push(`${t.id}/${s.id}/${lv}#${i + 1}: unknown speaker "${l.s}"`);
        }
      }
      if (!s.roleplay) w.push(`${t.id}/${s.id}: no roleplay`);
      for (const [band, sc] of Object.entries(s.roleplay || {})) {
        const ids = new Set(Object.keys(sc.nodes || {}));
        if (!ids.has(sc.start)) w.push(`${t.id}/${s.id}/${band}: start node "${sc.start}" missing`);
        for (const [id, n] of Object.entries(sc.nodes || {})) {
          for (const a of n.accept || []) {
            if (a.next && !ids.has(a.next) && a.next !== 'END') w.push(`${t.id}/${s.id}/${band}/${id}: dead link "${a.next}"`);
          }
        }
      }
    }
  }
  for (const [k, e] of Object.entries(dictionary)) {
    if (!e.en || !e.ur) w.push(`dict ${k}: missing en/ur`);
    if (!e.ex) w.push(`dict ${k}: no example sentence`);
  }
  return w;
}
