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

  // 3-level content tree:
  //   content/topics/<topic>/_topic.json                       -> topic meta
  //   content/topics/<topic>/<subtopic>/_sub.json              -> subtopic meta (+ test)
  //   content/topics/<topic>/<subtopic>/NN-<subsub>.json       -> one sub-subtopic (dialogues/roleplay)
  const topicDir = p('content', 'topics');
  const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99);
  const topics = [];
  if (fs.existsSync(topicDir)) {
    for (const tname of fs.readdirSync(topicDir).sort()) {
      const tdir = path.join(topicDir, tname);
      if (!fs.statSync(tdir).isDirectory()) continue;
      if (!fs.existsSync(path.join(tdir, '_topic.json'))) throw new Error(`content/topics/${tname}: no _topic.json`);
      const topic = readJson(path.join(tdir, '_topic.json'));
      topic.subtopics = [];
      for (const sname of fs.readdirSync(tdir).sort()) {
        const sdir = path.join(tdir, sname);
        if (sname === '_topic.json' || !fs.statSync(sdir).isDirectory()) continue;
        if (!fs.existsSync(path.join(sdir, '_sub.json'))) throw new Error(`content/topics/${tname}/${sname}: no _sub.json`);
        const sub = readJson(path.join(sdir, '_sub.json'));
        sub.subs = fs.readdirSync(sdir).filter((f) => f.endsWith('.json') && f !== '_sub.json').sort()
          .map((f) => readJson(path.join(sdir, f)))
          .sort(byOrder);
        topic.subtopics.push(sub);
      }
      topic.subtopics.sort(byOrder);
      topics.push(topic);
    }
    topics.sort(byOrder);
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
      for (const ss of s.subs || []) {
        const at = `${t.id}/${s.id}/${ss.id}`;
        for (const [lv, d] of Object.entries(ss.dialogues || {})) {
          (d.lines || []).forEach((l, i) => scan(l.de, `${at}/${lv}#${i + 1}`, l.w));
        }
        for (const [band, sc] of Object.entries(ss.roleplay || {})) {
          for (const [id, n] of Object.entries(sc.nodes || {})) {
            scan(n.say, `${at}/rp-${band}/${id}`);
            scan(n.fallback, `${at}/rp-${band}/${id}`);
            (n.accept || []).forEach((a) => scan(a.reply, `${at}/rp-${band}/${id}`));
          }
        }
        for (const k of ss.words || []) {
          if (!dictionary[k]) {
            const rec = miss.get(k) || { token: k, count: 0, where: [] };
            rec.count++; rec.where.push(`${at} words[]`);
            miss.set(k, rec);
          }
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
    for (const s of t.subtopics || []) {
      if (!s.test) w.push(`${t.id}/${s.id}: no test`);
      for (const ss of s.subs || []) {
        const at = `${t.id}/${s.id}/${ss.id}`;
        for (const lv of ['A1', 'A2', 'B1', 'B2']) {
          const d = ss.dialogues?.[lv];
          if (!d) { w.push(`${at}: missing level ${lv}`); continue; }
          if ((d.lines || []).length < 10) w.push(`${at}/${lv}: only ${d.lines.length} lines`);
          for (const [i, l] of d.lines.entries()) {
            if (!l.en || !l.ur) w.push(`${at}/${lv}#${i + 1}: missing en/ur`);
            if (!d.speakers?.[l.s]) w.push(`${at}/${lv}#${i + 1}: unknown speaker "${l.s}"`);
          }
        }
        if (!ss.roleplay) w.push(`${at}: no roleplay`);
        for (const [band, sc] of Object.entries(ss.roleplay || {})) {
          const ids = new Set(Object.keys(sc.nodes || {}));
          if (!ids.has(sc.start)) w.push(`${at}/${band}: start node "${sc.start}" missing`);
          for (const [id, n] of Object.entries(sc.nodes || {})) {
            for (const a of n.accept || []) {
              if (a.next && !ids.has(a.next) && a.next !== 'END') w.push(`${at}/${band}/${id}: dead link "${a.next}"`);
            }
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
