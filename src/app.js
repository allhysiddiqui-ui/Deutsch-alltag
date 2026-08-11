/* Deutsch Alltag — app engine. No network calls, no dependencies. */
(function () {
'use strict';

var D = window.__DATA__ || { topics: [], dictionary: {}, forms: {} };
var DICT = D.dictionary, FORMS = D.forms, TOPICS = D.topics;
var LEVELS = ['A1', 'A2', 'B1', 'B2'];
var LVNAME = { A1: 'Anfänger', A2: 'Grundlage', B1: 'Mittel', B2: 'Fortgeschr.' };

/* ---------------- storage ---------------- */
function ls(k, d) { try { var v = localStorage.getItem('dg.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function ss(k, v) { try { localStorage.setItem('dg.' + k, JSON.stringify(v)); } catch (e) {} }

var S = Object.assign({ level: 'A1', en: true, ur: true, theme: 'auto', rate: 1.0, mic: true, voice: '', aiUrl: '', aiKey: '', aiVoice: true }, ls('set', {}));
var SAVED = ls('saved', {});     // { wordKey: {t:timestamp, box:0} }
var PROG = ls('prog', {});       // { read:{'top/sub/lvl':1}, test:{topicId:pct}, rp:{'top/sub':1} }
if (!PROG.read) PROG.read = {}; if (!PROG.test) PROG.test = {}; if (!PROG.rp) PROG.rp = {};

function saveSet() { ss('set', S); applyTheme(); }
function saveProg() { ss('prog', PROG); }
function saveWords() { ss('saved', SAVED); }

/* "auto" leaves data-theme off entirely, so the CSS media query decides and any host
   page that stamps data-theme keeps control. An explicit choice sets the attribute. */
function applyTheme() {
  if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', S.theme);
}
applyTheme();

/* ---------------- utils ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function norm(s) {
  return String(s).toLowerCase().replace(/[^a-zäöüß'’\-]/g, '');
}
function plain(s) {
  return String(s).toLowerCase()
    .replace(/[.,!?;:„“"'’\-–—()]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  if (a === b) return 0;
  var m = a.length, n = b.length, i, j, prev = [], cur = [];
  if (!m) return n; if (!n) return m;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur.slice();
  }
  return prev[n];
}
function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function topicById(id) { for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].id === id) return TOPICS[i]; return null; }
function subById(t, id) { if (!t) return null; for (var i = 0; i < t.subtopics.length; i++) if (t.subtopics[i].id === id) return t.subtopics[i]; return null; }

/* ---------------- speech ---------------- */
var VOICE = null, VOICES = [];
function voiceId(v) { return v.voiceURI || v.name; }
/* Higher = more natural. The good voices are the cloud/"enhanced" ones — the plain
   offline default is the robotic one, so it must NOT win by default. */
function rankVoice(v) {
  var n = (v.name || '').toLowerCase(), s = 0;
  if ((v.lang || '').toLowerCase() === 'de-de') s += 2; else s += 1;
  if (n.indexOf('google') > -1) s += 4;
  if (/enhanced|premium|neural|natural|siri/.test(n)) s += 4;
  if (!v.localService) s += 1;
  if (/compact|espeak|pico|eloquence/.test(n)) s -= 4;
  return s;
}
function loadVoices() {
  if (!window.speechSynthesis) return;
  var vs = speechSynthesis.getVoices() || [];
  VOICES = vs.filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf('de') === 0; })
    .sort(function (a, b) { return rankVoice(b) - rankVoice(a); });
  pickVoice();
  // voices load asynchronously — if Settings is already open, refresh the list
  if ((location.hash || '') === '#/set' && typeof vSet === 'function') vSet();
}
function pickVoice() {
  VOICE = null;
  if (S.voice) for (var i = 0; i < VOICES.length; i++) if (voiceId(VOICES[i]) === S.voice) { VOICE = VOICES[i]; break; }
  if (!VOICE && VOICES.length) VOICE = VOICES[0];
}
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function sampleVoice(id) {
  if (!window.speechSynthesis) return;
  var v = null;
  for (var i = 0; i < VOICES.length; i++) if (voiceId(VOICES[i]) === id) { v = VOICES[i]; break; }
  try {
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance('Guten Tag! Ich helfe dir, Deutsch zu lernen.');
    u.lang = 'de-DE'; u.rate = Number(S.rate) || 0.9; if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function say(text, cb) {
  if (!window.speechSynthesis) { if (cb) cb(); return; }
  try {
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'de-DE'; u.rate = Number(S.rate) || 0.85;
    if (VOICE) u.voice = VOICE;
    if (cb) { u.onend = cb; u.onerror = cb; }
    speechSynthesis.speak(u);
  } catch (e) { if (cb) cb(); }
}
function hasMic() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/* ---------------- AI backend (optional, free Cloudflare Worker) ---------------- */
function aiConfigured() { return !!(S.aiUrl && S.aiKey); }
function aiFetch(path, body) {
  return fetch(S.aiUrl.replace(/\/+$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Pass': S.aiKey },
    body: JSON.stringify(body || {})
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      return d;
    });
  });
}
function aiChat(system, history) { return aiFetch('/chat', { system: system, history: history }).then(function (d) { return d.reply || ''; }); }
/* ---- natural voice with a permanent local cache ----
   Each unique German line is generated by the AI once, stored in IndexedDB, and
   replayed from there forever — free, instant, and works offline after the first play. */
var TTSDB = null;
function ttsDbOpen() {
  return new Promise(function (res) {
    if (TTSDB) return res(TTSDB);
    try {
      var rq = indexedDB.open('dg-tts', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('audio'); };
      rq.onsuccess = function () { TTSDB = rq.result; res(TTSDB); };
      rq.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}
function ttsGet(key) {
  return ttsDbOpen().then(function (db) {
    if (!db) return null;
    return new Promise(function (res) {
      try { var r = db.transaction('audio', 'readonly').objectStore('audio').get(key); r.onsuccess = function () { res(r.result || null); }; r.onerror = function () { res(null); }; }
      catch (e) { res(null); }
    });
  });
}
function ttsPut(key, val) { return ttsDbOpen().then(function (db) { if (db) try { db.transaction('audio', 'readwrite').objectStore('audio').put(val, key); } catch (e) {} }); }
function ttsClear() { return ttsDbOpen().then(function (db) { if (db) try { db.transaction('audio', 'readwrite').objectStore('audio').clear(); } catch (e) {} }); }
function ttsKey(text) { return 'v1|' + String(text).trim(); }

var AUDIO = null;
function stopAudio() {
  if (AUDIO) { try { AUDIO.pause(); } catch (e) {} AUDIO = null; }
  if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) {}
}
function playB64(b64, mime, done) {
  try {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/wav' }));
    var a = new Audio(url); AUDIO = a; var fired = false;
    var end = function () { if (fired) return; fired = true; try { URL.revokeObjectURL(url); } catch (e) {} if (done) done(); };
    a.onended = end; a.onerror = end;
    a.play().catch(end);
  } catch (e) { if (done) done(); }
}
/* speak via AI voice (cached), falling back to the device voice on any problem */
function aiSpeak(text, done) {
  text = String(text || '').trim(); if (!text) { if (done) done(); return; }
  var key = ttsKey(text);
  ttsGet(key).then(function (cached) {
    if (cached) { playB64(cached, 'audio/wav', done); return; }
    aiFetch('/tts', { text: text }).then(function (d) {
      if (d && d.audio) { ttsPut(key, d.audio); playB64(d.audio, d.mime || 'audio/wav', done); }
      else say(text, done);
    }).catch(function () { say(text, done); });
  }).catch(function () { say(text, done); });
}
/* the app's one speech entry point: AI voice when available, else device voice */
function speakAuto(text, done) {
  stopAudio();
  if (S.aiVoice && aiConfigured()) aiSpeak(text, done);
  else say(text, done);
}
function aiSystemPrompt(sc, level) {
  return 'Du spielst die Rolle: ' + sc.role + '. Der Nutzer ist: ' + sc.you + '. ' +
    'Szene: ' + sc.scene.de + ' ' +
    'Sprich ausschließlich Deutsch auf dem Niveau ' + level + '. ' +
    'Antworte kurz und natürlich, ein bis zwei Sätze, bleib in der Rolle und beim Thema. ' +
    'Wenn der Nutzer einen Fehler macht, benutze beiläufig die richtige Formulierung, ohne zu belehren. ' +
    'Wenn der Nutzer nicht weiterkommt, hilf mit einer einfacheren Frage. ' +
    'Bleibe freundlich und geduldig, wie mit einem Kind oder einem Deutschlerner.';
}

/* ---------------- dictionary lookup ---------------- */
var LINES = [];   // current render registry for per-line overrides
function lookup(tok, over) {
  var n = norm(tok);
  if (over) {
    if (over[tok] && DICT[over[tok]]) return DICT[over[tok]];
    if (over[n] && DICT[over[n]]) return DICT[over[n]];
  }
  if (DICT[n]) return DICT[n];
  if (FORMS[n] && DICT[FORMS[n]]) return DICT[FORMS[n]];
  if (n.indexOf('-') > -1) {
    var p = n.split('-');
    for (var i = 0; i < p.length; i++) { if (DICT[p[i]]) return DICT[p[i]]; if (FORMS[p[i]]) return DICT[FORMS[p[i]]]; }
  }
  return null;
}
function keyOf(entry) {
  for (var k in DICT) if (DICT[k] === entry) return k;
  return null;
}

var WORD_RE = /[A-Za-zÄÖÜäöüßéÉ]+(?:[’'\-][A-Za-zÄÖÜäöüß]+)*/g;
function tapText(text, lineIdx) {
  var out = '', last = 0, m;
  WORD_RE.lastIndex = 0;
  var over = (lineIdx != null && LINES[lineIdx]) ? LINES[lineIdx].w : null;
  while ((m = WORD_RE.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    var t = m[0], e = lookup(t, over);
    out += '<button class="w' + (e ? '' : ' miss') + '" data-w="' + esc(t) + '" data-li="' + (lineIdx == null ? '' : lineIdx) + '">' + esc(t) + '</button>';
    last = m.index + t.length;
  }
  out += esc(text.slice(last));
  return out;
}

/* ---------------- word sheet ---------------- */
function openWord(tok, lineIdx) {
  var over = (lineIdx !== '' && LINES[lineIdx]) ? LINES[lineIdx].w : null;
  var e = lookup(tok, over);
  var body;
  if (!e) {
    body = '<div class="wh"><div><div class="lem">' + esc(tok) + '</div></div></div>' +
      '<p class="muted small" style="margin-top:14px">Dieses Wort ist noch nicht im Wörterbuch. / This word is not in the dictionary yet.</p>';
  } else {
    var k = keyOf(e);
    var head = (e.gender ? '<span class="art">' + esc(e.gender) + '</span> ' : '') + esc(e.lemma);
    var meta = [];
    if (e.pos) meta.push(e.pos);
    if (e.plural) meta.push('Pl. ' + e.plural);
    if (e.aux) meta.push(e.aux);
    var starred = !!SAVED[k];
    body =
      '<div class="wh">' +
        '<div style="flex:1"><div class="lem">' + head + '</div>' +
          (meta.length ? '<div class="forms">' + esc(meta.join(' · ')) + '</div>' : '') +
        '</div>' +
        '<button class="ico" data-act="sayw" data-t="' + esc(e.lemma) + '">🔊</button>' +
        '<button class="ico" data-act="star" data-k="' + esc(k) + '">' + (starred ? '★' : '☆') + '</button>' +
      '</div>' +
      (e.note ? '<div class="tag" style="margin-top:8px;display:inline-block">' + esc(e.note) + '</div>' : '') +
      '<div style="margin-top:10px">' +
        '<div class="mrow"><div class="k">EN</div><div class="v">' + esc(e.en) + '</div></div>' +
        '<div class="mrow" style="border-bottom:0"><div class="k">UR</div><div class="v">' + esc(e.ur) + '</div></div>' +
      '</div>' +
      (e.ex ? '<div class="ex">' +
        '<div class="exde">' + esc(e.ex.de) + ' <button class="mini" data-act="sayw" data-t="' + esc(e.ex.de) + '">🔊</button></div>' +
        '<div class="exen">' + esc(e.ex.en) + '</div>' +
        '<div class="exur">' + esc(e.ex.ur) + '</div>' +
      '</div>' : '');
  }
  document.getElementById('sheetBody').innerHTML = body;
  document.getElementById('sheet').classList.add('on');
  document.getElementById('scrim').classList.add('on');
}
function closeSheet() {
  document.getElementById('sheet').classList.remove('on');
  document.getElementById('scrim').classList.remove('on');
}

/* ---------------- shell ---------------- */
function view(o) {
  var hd = document.getElementById('hd');
  hd.innerHTML =
    (o.back ? '<button class="ico" data-act="back">‹</button>' : '<div class="ico">📘</div>') +
    '<div class="ttl">' + esc(o.title) + (o.sub ? '<span class="sub">' + esc(o.sub) + '</span>' : '') + '</div>' +
    (o.chip ? '<button class="chip" data-act="lvl">' + esc(o.chip) + '</button>' : '') +
    (o.right || '');
  document.getElementById('app').innerHTML = '<div class="wrap">' + o.body + '</div>';
  window.scrollTo(0, 0);
  var nav = document.getElementById('nav');
  var h = location.hash || '#/';
  [['#/', 'n1'], ['#/words', 'n2'], ['#/search', 'n3'], ['#/set', 'n4']].forEach(function (p) {
    var a = document.getElementById(p[1]);
    if (a) a.className = (h === p[0] || (p[0] === '#/' && h.indexOf('#/t/') === 0) ||
      (p[0] === '#/' && (h.indexOf('#/d/') === 0 || h.indexOf('#/test') === 0 || h.indexOf('#/rp/') === 0))) ? 'on' : '';
  });
  nav.style.display = '';
}

function levelSheet() {
  var b = '<div class="grab"></div><h3 style="margin:0 0 4px">Sprachniveau / Level</h3>' +
    '<p class="muted small" style="margin:0 0 14px">Same conversations, different German. / Wohi baat cheet, alag German.</p>' +
    '<div class="levels">';
  LEVELS.forEach(function (l) {
    b += '<button class="lv' + (S.level === l ? ' on' : '') + '" data-act="setlvl" data-l="' + l + '">' + l + '<span class="n">' + esc(LVNAME[l]) + '</span></button>';
  });
  b += '</div>';
  document.getElementById('sheetBody').innerHTML = b;
  document.getElementById('sheet').classList.add('on');
  document.getElementById('scrim').classList.add('on');
}

/* ---------------- views ---------------- */
function vHome() {
  var b = '<div class="sec">Niveau</div><div class="levels">';
  LEVELS.forEach(function (l) {
    b += '<button class="lv' + (S.level === l ? ' on' : '') + '" data-act="setlvl" data-l="' + l + '">' + l + '<span class="n">' + esc(LVNAME[l]) + '</span></button>';
  });
  b += '</div><div class="sec">Themen / Topics</div><div class="grid">';
  TOPICS.forEach(function (t) {
    var tot = 0, done = 0;
    t.subtopics.forEach(function (s) { tot++; if (PROG.read[t.id + '/' + s.id + '/' + S.level]) done++; });
    var pct = tot ? Math.round(done / tot * 100) : 0;
    b += '<button class="tile" data-go="#/t/' + t.id + '">' +
      '<span class="em">' + esc(t.icon) + '</span>' +
      '<span class="t">' + esc(t.title.de) + '</span>' +
      '<span class="s">' + esc(t.title.en) + ' · ' + t.subtopics.length + ' Teile</span>' +
      '<span class="bar"><i style="width:' + pct + '%"></i></span>' +
      '</button>';
  });
  b += '</div>';
  var n = Object.keys(SAVED).length;
  if (n) b += '<div class="sec">Weiter</div><button class="row" data-go="#/fc"><div class="ico">🃏</div>' +
    '<div class="g"><div class="t">Karteikarten üben</div><div class="s">' + n + ' gespeicherte Wörter</div></div><div class="ar">›</div></button>';
  view({ title: 'Deutsch Alltag', sub: 'Alltagsgespräche · A1–B2', body: b, chip: S.level });
}

function vTopic(tid) {
  var t = topicById(tid); if (!t) return go('#/');
  var b = '<div class="card" style="padding:14px;margin-bottom:16px">' +
    '<div style="font-size:15px;font-weight:640">' + esc(t.title.en) + '</div>' +
    '<div class="small muted" style="margin-top:3px">' + esc(t.title.ur) + '</div>' +
    (t.intro ? '<div class="small muted" style="margin-top:8px">' + esc(t.intro) + '</div>' : '') + '</div>';
  b += '<div class="sec">Gespräche / Conversations</div><div class="rowlist">';
  t.subtopics.forEach(function (s) {
    var read = PROG.read[t.id + '/' + s.id + '/' + S.level];
    var has = s.dialogues && s.dialogues[S.level];
    b += '<button class="row" data-go="#/d/' + t.id + '/' + s.id + '"' + (has ? '' : ' disabled') + '>' +
      '<div class="ico">' + esc(s.icon || '💬') + '</div>' +
      '<div class="g"><div class="t">' + esc(s.title.de) + '</div>' +
      '<div class="s">' + esc(s.angle) + '</div></div>' +
      (read ? '<div class="dot"></div>' : '') + '<div class="ar">›</div></button>';
  });
  b += '</div>';
  b += '<div class="sec">Üben / Practice</div><div class="rowlist">';
  t.subtopics.forEach(function (s) {
    if (!s.roleplay) return;
    var done = PROG.rp[t.id + '/' + s.id];
    b += '<button class="row" data-go="#/rp/' + t.id + '/' + s.id + '">' +
      '<div class="ico">🎙️</div><div class="g"><div class="t">Rollenspiel: ' + esc(s.title.de) + '</div>' +
      '<div class="s">Sprich mit der App / App se baat karein</div></div>' +
      (done ? '<div class="dot"></div>' : '') + '<div class="ar">›</div></button>';
  });
  if (t.test) {
    var sc = PROG.test[t.id];
    b += '<button class="row" data-go="#/test/' + t.id + '">' +
      '<div class="ico">📝</div><div class="g"><div class="t">Test: ' + esc(t.title.de) + '</div>' +
      '<div class="s">' + (sc != null ? 'Letztes Ergebnis: ' + sc + '%' : t.test.items.length + ' Aufgaben') + '</div></div><div class="ar">›</div></button>';
  }
  b += '</div>';
  view({ title: t.title.de, sub: t.title.en, body: b, back: 1, chip: S.level });
}

function vDialogue(tid, sid) {
  var t = topicById(tid), s = subById(t, sid); if (!s) return go('#/');
  var d = s.dialogues[S.level];
  if (!d) { view({ title: s.title.de, body: '<div class="empty"><span class="em">🚧</span>Diese Stufe fehlt noch.</div>', back: 1, chip: S.level }); return; }
  LINES = d.lines;
  PROG.read[tid + '/' + sid + '/' + S.level] = 1; saveProg();

  var b = '<div class="card" style="padding:12px 14px;margin-bottom:14px">' +
    '<div class="small" style="font-weight:640">' + esc(s.angle) + '</div>' +
    '<div class="small muted" style="margin-top:4px">Tippe auf ein Wort = Bedeutung. Tippe auf die Blase = Übersetzung.</div>' +
    '<div class="small muted" style="margin-top:2px;font-style:italic">Lafz par tap karein = matlab. Bubble par tap karein = tarjuma.</div>' +
    '<div class="btns"><button class="btn gh" data-act="playall">▶︎ Ganzes Gespräch hören</button></div></div>';

  d.lines.forEach(function (l, i) {
    var right = l.s === (d.right || 'B');
    b += '<div class="bub' + (right ? ' r' : '') + '" data-b="' + i + '">' +
      '<div class="who">' + esc(d.speakers[l.s] || l.s) + '</div>' +
      '<div class="bl">' +
        '<div class="de" data-de="' + i + '">' + tapText(l.de, i) + '</div>' +
        '<div class="tr">' +
          (S.en ? '<div class="en">' + esc(l.en) + '</div>' : '') +
          (S.ur ? '<div class="ur">' + esc(l.ur) + '</div>' : '') +
        '</div>' +
        '<div class="blact">' +
          '<button class="mini" data-act="sayline" data-i="' + i + '">🔊</button>' +
          '<button class="mini" data-act="tr" data-i="' + i + '">A→B</button>' +
        '</div>' +
      '</div></div>';
  });

  if (s.words && s.words.length) {
    b += '<div class="sec">Wortschatz</div><div class="card">';
    s.words.forEach(function (k) {
      var e = DICT[k]; if (!e) return;
      b += '<div class="wc"><div class="g"><div class="l">' + (e.gender ? e.gender + ' ' : '') + esc(e.lemma) + '</div>' +
        '<div class="m">' + esc(e.en) + ' · ' + esc(e.ur) + '</div></div>' +
        '<button class="mini" data-act="sayw" data-t="' + esc(e.lemma) + '">🔊</button>' +
        '<button class="mini" data-act="star" data-k="' + esc(k) + '">' + (SAVED[k] ? '★' : '☆') + '</button></div>';
    });
    b += '</div>';
  }
  if (s.roleplay) b += '<div class="btns" style="margin-top:18px"><button class="btn" data-go="#/rp/' + tid + '/' + sid + '">🎙️ Jetzt selbst sprechen</button></div>';

  view({ title: s.title.de, sub: t.title.de, body: b, back: 1, chip: S.level });
}

/* ---------------- roleplay ---------------- */
var RP = null, REC = null;
var RP_FALLBACKS = [
  'Wie bitte?',
  'Entschuldigung, das habe ich nicht ganz verstanden.',
  'Können Sie das noch einmal sagen?',
  'Wie meinen Sie das?'
];
var RP_PHASE_LABEL = {
  idle: 'Tippe die Taste und sprich',
  speaking: '…',
  listening: 'Sprich jetzt',
  thinking: 'einen Moment…'
};
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function rpSayText(node) { return Array.isArray(node.say) ? pick(node.say) : node.say; }

function vRoleplay(tid, sid) {
  var t = topicById(tid), s = subById(t, sid); if (!s || !s.roleplay) return go('#/');
  var band = (S.level === 'A1' || S.level === 'A2') ? 'easy' : 'hard';
  var sc = s.roleplay[band] || s.roleplay.easy || s.roleplay.hard;
  RP = { t: t, s: s, sc: sc, node: sc.start, log: [], turns: 0, good: 0,
    showOpts: false, mode: 'manual', phase: 'idle', misses: 0, noSpeech: 0, hint: '', timer: null };
}
function rpStart() {
  var n = RP.sc.nodes[RP.node];
  if (n && n.say) RP.log.push({ me: false, text: rpSayText(n) });
  rpRender(true);
}

function rpRender(speak) {
  var sc = RP.sc, n = sc.nodes[RP.node];
  var b = '<div class="card" style="padding:12px 14px;margin-bottom:12px">' +
    '<div class="small" style="font-weight:640">' + esc(sc.scene.de) + '</div>' +
    '<div class="small muted" style="margin-top:3px">' + esc(sc.scene.en) + '</div>' +
    '<div class="small muted" style="margin-top:2px;font-style:italic">' + esc(sc.scene.ur) + '</div>' +
    '<div class="small muted" style="margin-top:8px">Du bist: <b>' + esc(sc.you) + '</b> · App: <b>' + esc(sc.role) + '</b></div></div>';

  b += '<div class="rp">';
  RP.log.forEach(function (m) {
    if (m.me) b += '<div class="rpb me ' + (m.grade === 'good' ? 'ok' : m.grade === 'bad' ? 'no' : '') + '">' + esc(m.text) + '</div>';
    else b += '<div class="rpb">' + tapText(m.text, null) + '</div>';
  });
  b += '</div>';

  if (!n) {
    var pct = RP.turns ? Math.round(RP.good / RP.turns * 100) : 0;
    PROG.rp[RP.t.id + '/' + RP.s.id] = 1; saveProg();
    b += '<div class="card" style="padding:18px"><div class="score">' + pct + '%</div>' +
      '<div class="center muted small">' + RP.good + ' von ' + RP.turns + ' Antworten passend</div>' +
      '<div class="btns"><button class="btn sec" data-act="rpagain">Nochmal</button>' +
      '<button class="btn" data-go="#/t/' + RP.t.id + '">Fertig</button></div></div>';
    view({ title: 'Rollenspiel', sub: RP.s.title.de, body: b, back: 1, chip: S.level });
    return;
  }

  var liveLike = RP.mode === 'live' || RP.mode === 'ai';
  if (RP.mode !== 'ai') {
    b += '<div class="goal"><b>Was du sagen sollst / Aap ko kya kehna hai</b>' + esc(n.goal.en) +
      '<div style="margin-top:4px;font-style:italic">' + esc(n.goal.ur) + '</div></div>';
  } else {
    b += '<div class="goal"><b>KI-Gespräch</b>Sprich frei mit ' + esc(sc.role) + '. Die KI versteht dich und antwortet.' +
      '<div style="margin-top:4px;font-style:italic">Aap khul kar baat karein — KI samajhti hai.</div></div>';
  }

  var canLive = hasMic() && S.mic;
  b += '<div class="card" style="padding:14px">';

  if (liveLike) {
    var ph = RP.phase || 'idle';
    var ic = ph === 'listening' ? '🎙️' : ph === 'speaking' ? '🔊' : ph === 'thinking' ? '…' : '▶';
    b += '<div class="orbwrap">' +
      '<button class="orb ' + ph + '" id="rporb" data-act="rporbtap"><span id="rporbic">' + ic + '</span></button>' +
      '<div class="orblabel" id="rporblab">' + esc(RP.phase ? (RP_PHASE_LABEL[ph] || '') : RP_PHASE_LABEL.idle) + '</div></div>';
    b += '<div class="btns"><button class="btn sec" data-act="rplivestop">⏸ Stopp</button>' +
      (RP.mode === 'live' ? '<button class="btn sec" data-act="rphelp" style="flex:0 0 56px">💡</button>' : '') +
      '<button class="btn sec" data-act="rprep" style="flex:0 0 56px">🔊</button></div>';
    // typing works inside live/AI mode too
    b += '<div class="btns" style="margin-top:8px"><input class="inp" id="rpin" placeholder="…oder tippen" autocomplete="off" autocapitalize="sentences">' +
      '<button class="btn sec" data-act="rpsend" style="flex:0 0 84px">Senden</button></div>';
  } else {
    if (aiConfigured()) {
      b += '<button class="btn" data-act="rpstartai">🤖 Frei sprechen mit KI</button>' +
        '<div class="livehint">Die KI antwortet als ' + esc(sc.role) + ' und versteht, was du sagst.</div>' +
        '<div style="height:1px;background:var(--line);margin:14px 0"></div>';
    }
    if (canLive) {
      b += '<button class="btn' + (aiConfigured() ? ' sec' : '') + '" data-act="rpstartlive">🎙️ Nach Drehbuch sprechen</button>' +
        '<div class="livehint">Festes Gespräch: die App spricht, hört zu und antwortet — ohne Tippen.</div>' +
        '<div style="height:1px;background:var(--line);margin:14px 0"></div>';
    }
    b += '<input class="inp" id="rpin" placeholder="Auf Deutsch antworten…" autocomplete="off" autocapitalize="sentences">';
    b += '<div class="btns"><button class="btn' + (canLive || aiConfigured() ? ' sec' : '') + '" data-act="rpsend">Senden</button></div>';
    b += '<div class="btns"><button class="btn sec" data-act="rphelp">' + (RP.showOpts ? 'Hilfe ausblenden' : '💡 Hilfe zeigen') + '</button>' +
      '<button class="btn sec" data-act="rprep" style="flex:0 0 64px">🔊</button></div>';
  }

  if (RP.mode !== 'ai' && RP.showOpts && n.options) {
    b += '<div style="margin-top:10px">';
    n.options.forEach(function (o) { b += '<button class="opt" data-act="rppick" data-o="' + esc(o) + '">' + esc(o) + '</button>'; });
    b += '</div>';
  }
  if (RP.hint) b += '<div class="livehint" style="color:var(--warn)">' + esc(RP.hint) + '</div>';
  b += '</div>';
  if (!canLive) b += '<p class="small muted center" style="margin-top:12px">Sprechen braucht Internet und Chrome oder Safari. Tippen geht immer.</p>';

  view({ title: 'Rollenspiel', sub: RP.s.title.de, body: b, back: 1, chip: S.level });
  if (speak && !liveLike && RP.log.length) {
    for (var i = RP.log.length - 1; i >= 0; i--) if (!RP.log[i].me) { say(RP.log[i].text); break; }
  }
}

/* evaluate one answer, mutate state, return {grade, newApp, ended} */
function rpEval(txt) {
  txt = String(txt || '').trim(); if (!txt) return null;
  var n = RP.sc.nodes[RP.node];
  var words = plain(txt).split(' ');
  var best = null;
  (n.accept || []).forEach(function (a) {
    var hits = 0;
    a.kw.forEach(function (k) {
      var kk = plain(k);
      for (var i = 0; i < words.length; i++) {
        if (words[i] === kk || (kk.length > 3 && lev(words[i], kk) <= Math.max(1, Math.floor(kk.length / 5)))) { hits++; return; }
      }
    });
    var sc = a.kw.length ? hits / a.kw.length : 0;
    if (!best || sc > best.sc) best = { a: a, sc: sc };
  });
  RP.turns++;
  var newApp = [];
  if (best && best.sc >= 0.55) {
    var grade = best.sc >= 0.999 ? 'good' : 'ok';
    if (grade === 'good') RP.good++;
    RP.misses = 0; RP.hint = '';
    RP.log.push({ me: true, text: txt, grade: grade });
    if (best.a.reply) { RP.log.push({ me: false, text: best.a.reply }); newApp.push(best.a.reply); }
    RP.node = best.a.next;
    var nx = RP.sc.nodes[RP.node];
    if (nx && nx.say) { var st = rpSayText(nx); RP.log.push({ me: false, text: st }); newApp.push(st); }
    RP.showOpts = false;
    return { grade: grade, newApp: newApp, ended: !RP.sc.nodes[RP.node] };
  }
  RP.misses++;
  RP.log.push({ me: true, text: txt, grade: 'bad' });
  var fb = (RP.misses >= 2 || !n.fallback) ? pick(RP_FALLBACKS) : n.fallback;
  RP.log.push({ me: false, text: fb }); newApp.push(fb);
  if (RP.misses >= 2 && n.options) RP.showOpts = true;
  return { grade: 'bad', newApp: newApp, ended: false };
}

/* send an answer from anywhere (typed, option-tap, or voice) */
function rpDeliver(txt) {
  txt = String(txt || '').trim(); if (!txt) return;
  rpStopRec();
  if (RP.mode === 'ai') { rpSubmitAi(txt); }
  else if (RP.mode === 'live') { rpSubmitLive(txt); }
  else { if (rpEval(txt)) rpRender(true); }
}
function rpAnswer(txt) { rpDeliver(txt); }

/* ---- live (hands-free) mode ---- */
function rpSetPhase(phase, label) {
  RP.phase = phase;
  var orb = document.getElementById('rporb'); if (orb) orb.className = 'orb ' + phase;
  var ic = document.getElementById('rporbic');
  if (ic) ic.textContent = phase === 'listening' ? '🎙️' : phase === 'speaking' ? '🔊' : phase === 'thinking' ? '…' : '▶';
  var lab = document.getElementById('rporblab'); if (lab) lab.textContent = label || RP_PHASE_LABEL[phase] || '';
}
function rpTrailingApp() {
  var out = [];
  for (var i = RP.log.length - 1; i >= 0; i--) { if (RP.log[i].me) break; out.unshift(RP.log[i].text); }
  return out;
}
function rpSpeakSequence(texts, done) {
  if (!texts || !texts.length) { if (done) done(); return; }
  rpSetPhase('speaking');
  var i = 0;
  (function nxt() {
    if (RP.mode !== 'live' && RP.mode !== 'ai') return;
    if (i >= texts.length) { if (done) done(); return; }
    var t = texts[i++], fired = false;
    var step = function () { if (fired) return; fired = true; clearTimeout(RP.timer); RP.timer = setTimeout(nxt, 240); };
    // watchdog: some browsers (notably iOS Safari) drop the speech-ended event,
    // so advance anyway after an estimate rather than freezing the conversation.
    var ms = Math.max(1600, String(t).split(/\s+/).length * 400 / (Number(S.rate) || 0.85));
    RP.timer = setTimeout(step, ms);
    say(t, step);
  })();
}
function rpBeginLive() {
  if (!hasMic() || !S.mic) return;
  RP.mode = 'live'; RP.hint = ''; RP.noSpeech = 0;
  rpRender(false);
  rpSpeakSequence(rpTrailingApp(), function () { rpListen(); });
}
function rpStopRec() { if (REC) { try { REC.abort(); } catch (e) {} REC = null; } }
function rpListen() {
  if (RP.mode !== 'live' && RP.mode !== 'ai') return;
  var C = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!C) {
    if (RP.mode === 'ai') { rpSetPhase('idle', 'Tippe deine Antwort'); return; }
    rpDropToManual('Sprechen wird in diesem Browser nicht unterstützt — bitte tippen.'); return;
  }
  rpSetPhase('listening', RP_PHASE_LABEL.listening);
  rpStopRec();
  REC = new C(); REC.lang = 'de-DE'; REC.interimResults = false; REC.maxAlternatives = 3;
  var got = false;
  REC.onresult = function (ev) { got = true; var txt = ev.results[0][0].transcript; rpStopRec(); rpDeliver(txt); };
  REC.onerror = function (ev) {
    rpStopRec();
    if (RP.mode === 'ai' && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'network')) {
      RP.hint = 'Mikrofon nicht verfügbar — tippe deine Antwort.'; rpSetPhase('idle', 'Tippe deine Antwort'); return;
    }
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') rpDropToManual('Bitte das Mikrofon erlauben. Danach die runde Taste drücken oder tippen.');
    else if (ev.error === 'network') rpDropToManual('Spracherkennung braucht Internet — bitte tippen.');
    else if (ev.error === 'no-speech') {
      RP.noSpeech++;
      if (RP.noSpeech >= 2) { rpSetPhase('idle'); RP.hint = 'Ich habe nichts gehört. Drück die grüne Taste und sprich, oder tippe.'; var l = document.getElementById('rporblab'); if (l) l.textContent = RP_PHASE_LABEL.idle; }
      else rpSetPhase('idle', 'Ich höre dich nicht — Taste drücken und sprechen');
    } else rpSetPhase('idle');
  };
  REC.onend = function () { if (!got && RP.phase === 'listening') rpSetPhase('idle'); };
  try { REC.start(); } catch (e) { rpSetPhase('idle', 'Taste drücken und sprechen'); }
}
function rpSubmitLive(txt) {
  RP.noSpeech = 0;
  rpSetPhase('thinking');
  clearTimeout(RP.timer);
  RP.timer = setTimeout(function () {
    var r = rpEval(txt);
    rpRender(false);
    if (!r) { rpSetPhase('idle'); return; }
    if (r.ended) { RP.mode = 'live'; rpSpeakSequence(r.newApp, function () { RP.mode = 'manual'; }); }
    else rpSpeakSequence(r.newApp, function () { rpListen(); });
  }, 520);
}
function rpDropToManual(msg) {
  rpStopLive(true);
  RP.mode = 'manual'; RP.hint = msg || ''; RP.showOpts = true;
  rpRender(false);
}
function rpStopLive(silent) {
  stopAudio();
  rpStopRec();
  if (RP) { clearTimeout(RP.timer); RP.mode = 'manual'; RP.phase = 'idle'; if (!silent) rpRender(false); }
}
function rpOrbTap() {
  if (RP.phase === 'listening') { rpStopRec(); rpSetPhase('idle'); }
  else if (RP.phase === 'idle') { RP.hint = ''; rpListen(); }
}

/* ---- AI mode: free conversation via the Worker backend ---- */
function rpPlay(text, done) {
  if (RP.mode !== 'ai') { if (done) done(); return; }
  rpSetPhase('speaking');
  var fired = false;
  var step = function () { if (fired) return; fired = true; clearTimeout(RP.timer); if (done) done(); };
  // watchdog covers network + playback so a dropped event can't freeze the turn
  RP.timer = setTimeout(step, Math.max(3000, String(text).split(/\s+/).length * 500) + 8000);
  if (S.aiVoice && aiConfigured()) aiSpeak(text, step); else say(text, step);
}
function rpAiContinue() {
  if (RP.mode !== 'ai') return;
  if (hasMic() && S.mic) rpListen();
  else rpSetPhase('idle', 'Tippe deine Antwort');
}
function rpBeginAi() {
  if (!aiConfigured()) { RP.hint = 'Bitte zuerst in „Mehr" die KI einrichten.'; rpRender(false); return; }
  RP.mode = 'ai'; RP.hint = ''; RP.log = []; RP.turns = 0;
  RP.ai = { system: aiSystemPrompt(RP.sc, S.level), history: [] };
  rpRender(false);
  rpSetPhase('thinking', 'einen Moment…');
  aiChat(RP.ai.system, [{ role: 'user', text: '(Beginne das Gespräch mit einer kurzen Begrüßung.)' }]).then(function (reply) {
    if (RP.mode !== 'ai') return;
    reply = reply || 'Guten Tag!';
    RP.ai.history.push({ role: 'model', text: reply });
    RP.log.push({ me: false, text: reply }); rpRender(false);
    rpPlay(reply, rpAiContinue);
  }).catch(function (e) {
    RP.hint = 'KI nicht erreichbar: ' + e.message + '. Prüfe die Einstellungen.';
    rpStopLive(false);
  });
}
function rpSubmitAi(txt) {
  txt = String(txt || '').trim(); if (!txt) return;
  RP.noSpeech = 0;
  RP.ai.history.push({ role: 'user', text: txt });
  RP.log.push({ me: true, text: txt, grade: 'ok' }); RP.turns++;
  rpRender(false); rpSetPhase('thinking', 'einen Moment…');
  aiChat(RP.ai.system, RP.ai.history).then(function (reply) {
    if (RP.mode !== 'ai') return;
    reply = reply || 'Wie bitte?';
    RP.ai.history.push({ role: 'model', text: reply });
    RP.log.push({ me: false, text: reply }); rpRender(false);
    rpPlay(reply, rpAiContinue);
  }).catch(function (e) {
    RP.hint = 'KI-Fehler: ' + e.message; rpSetPhase('idle', 'Tippe deine Antwort'); rpRender(false);
  });
}

/* ---------------- test ---------------- */
var T = null;
function vTest(tid) {
  var t = topicById(tid); if (!t || !t.test) return go('#/');
  T = { t: t, items: shuffle(t.test.items), i: 0, right: 0, state: 'ask', pick: null, built: [], pool: [] };
  tRender();
}
function tRender() {
  var it = T.items[T.i];
  if (!it) return tDone();
  var pct = Math.round(T.i / T.items.length * 100);
  var b = '<div class="prog"><i style="width:' + pct + '%"></i></div>' +
    '<div class="small muted" style="margin-bottom:12px">Aufgabe ' + (T.i + 1) + ' von ' + T.items.length + '</div>';

  if (it.type === 'mc') {
    b += '<div class="q">' + esc(it.q) + '</div><div class="qh">Was bedeutet das? / Iska matlab kya hai?</div>';
    (it._opts || (it._opts = shuffle(it.opts.map(function (o, i) { return { o: o, i: i }; })))).forEach(function (o, idx) {
      var cls = 'opt';
      if (T.state === 'done') { if (o.i === it.a) cls += ' good'; else if (T.pick === idx) cls += ' bad'; }
      else if (T.pick === idx) cls += ' sel';
      b += '<button class="' + cls + '" data-act="tpick" data-i="' + idx + '">' + esc(o.o) + '</button>';
    });
  } else if (it.type === 'gap') {
    b += '<div class="q">' + esc(it.de.replace('___', '_____')) + '</div><div class="qh">' + esc(it.hint || '') + '</div>' +
      '<input class="inp" id="tin" placeholder="Fehlendes Wort…" autocomplete="off"' + (T.state === 'done' ? ' disabled' : '') + '>';
  } else if (it.type === 'order') {
    b += '<div class="q">' + esc(it.en) + '</div><div class="qh">Baue den deutschen Satz. / German jumla banayein.</div>';
    if (!it._pool) { it._pool = shuffle(it.a.replace(/[.?!]$/, '').split(' ')); T.built = []; }
    b += '<div class="tiles">' + T.built.map(function (w, i) { return '<button class="tk" data-act="tunbuild" data-i="' + i + '">' + esc(w) + '</button>'; }).join('') + '</div>';
    b += '<div class="tiles" style="background:transparent;padding:0">' + it._pool.map(function (w, i) {
      return T.built.indexOf(i) > -1 ? '' : '<button class="tk" data-act="tbuild" data-i="' + i + '">' + esc(w) + '</button>';
    }).join('') + '</div>';
  } else if (it.type === 'listen') {
    b += '<div class="q">Hör zu und schreib den Satz.</div><div class="qh">Suno aur likho.</div>' +
      '<div class="btns" style="margin-bottom:12px"><button class="btn gh" data-act="sayw" data-t="' + esc(it.a) + '">🔊 Nochmal hören</button></div>' +
      '<input class="inp" id="tin" placeholder="Satz auf Deutsch…" autocomplete="off"' + (T.state === 'done' ? ' disabled' : '') + '>';
  } else if (it.type === 'prod') {
    b += '<div class="q">' + esc(it.en) + '</div><div class="qh">' + esc(it.ur || '') + '</div>' +
      '<input class="inp" id="tin" placeholder="Auf Deutsch schreiben…" autocomplete="off"' + (T.state === 'done' ? ' disabled' : '') + '>';
  }

  if (T.state === 'done') {
    var fb = T.last;
    b += '<div class="fb ' + fb.cls + '"><b>' + esc(fb.head) + '</b>' + esc(fb.msg) + '</div>';
    b += '<div class="btns"><button class="btn" data-act="tnext">Weiter ›</button></div>';
  } else {
    b += '<div class="btns"><button class="btn" data-act="tcheck">Prüfen</button></div>';
  }
  view({ title: 'Test: ' + T.t.title.de, body: b, back: 1, chip: S.level });
  var inp = document.getElementById('tin');
  if (inp && T.state !== 'done') inp.focus();
}
function tCheck() {
  var it = T.items[T.i], ok = false, given = '';
  if (it.type === 'mc') {
    if (T.pick == null) return;
    ok = it._opts[T.pick].i === it.a;
    given = it._opts[T.pick].o;
  } else if (it.type === 'order') {
    given = T.built.map(function (i) { return it._pool[i]; }).join(' ');
    ok = plain(given) === plain(it.a);
  } else {
    var el = document.getElementById('tin');
    given = el ? el.value : '';
    var a = plain(it.type === 'gap' ? it.a : it.a), g = plain(given);
    ok = g === a;
    if (!ok && g && lev(g, a) <= Math.max(1, Math.round(a.length / 12))) {
      T.last = { cls: 'warn', head: 'Fast richtig!', msg: 'Richtig: ' + it.a + (it.en ? '  —  ' + it.en : '') };
      T.right += 0.5; T.state = 'done'; tRender(); return;
    }
  }
  if (ok) { T.right++; T.last = { cls: 'good', head: 'Richtig!', msg: (it.a && it.type !== 'mc' ? it.a : '') + (it.en ? '  —  ' + it.en : '') }; }
  else {
    var corr = it.type === 'mc' ? it.opts[it.a] : it.a;
    T.last = { cls: 'bad', head: 'Nicht ganz.', msg: 'Richtig: ' + corr + (it.ur ? '  ·  ' + it.ur : '') };
    if (it.word && DICT[it.word] && !SAVED[it.word]) { SAVED[it.word] = { t: Date.now(), box: 0 }; saveWords(); }
  }
  T.state = 'done'; tRender();
}
function tDone() {
  var pct = Math.round(T.right / T.items.length * 100);
  PROG.test[T.t.id] = pct; saveProg();
  var msg = pct >= 80 ? 'Sehr gut! / Bohat acha!' : pct >= 50 ? 'Gut — üb die falschen Wörter.' : 'Weiter üben. Lies das Gespräch nochmal.';
  var b = '<div class="card" style="padding:22px"><div class="score">' + pct + '%</div>' +
    '<div class="center muted small">' + T.right + ' / ' + T.items.length + ' richtig</div>' +
    '<p class="center" style="margin:16px 0 0">' + esc(msg) + '</p>' +
    '<div class="btns"><button class="btn sec" data-act="tagain">Nochmal</button>' +
    '<button class="btn" data-go="#/t/' + T.t.id + '">Fertig</button></div></div>' +
    '<p class="small muted center" style="margin-top:14px">Falsche Wörter sind jetzt bei „Meine Wörter“.</p>';
  view({ title: 'Ergebnis', body: b, back: 1, chip: S.level });
}

/* ---------------- words + flashcards ---------------- */
function vWords() {
  var keys = Object.keys(SAVED).sort(function (a, b) { return SAVED[b].t - SAVED[a].t; });
  var b = '';
  if (!keys.length) {
    b = '<div class="empty"><span class="em">☆</span>Noch keine Wörter gespeichert.<br>Tippe auf ein Wort im Gespräch und dann auf ☆.</div>';
  } else {
    b += '<div class="btns" style="margin-bottom:16px"><button class="btn" data-go="#/fc">🃏 Karteikarten (' + keys.length + ')</button></div><div class="card">';
    keys.forEach(function (k) {
      var e = DICT[k]; if (!e) return;
      b += '<div class="wc"><div class="g"><div class="l">' + (e.gender ? e.gender + ' ' : '') + esc(e.lemma) + '</div>' +
        '<div class="m">' + esc(e.en) + ' · ' + esc(e.ur) + '</div></div>' +
        '<button class="mini" data-act="sayw" data-t="' + esc(e.lemma) + '">🔊</button>' +
        '<button class="mini" data-act="unstar" data-k="' + esc(k) + '">✕</button></div>';
    });
    b += '</div>';
  }
  view({ title: 'Meine Wörter', sub: 'Saved words', body: b, chip: S.level });
}
var FC = null;
function vFC() {
  var keys = Object.keys(SAVED).filter(function (k) { return DICT[k]; });
  if (!keys.length) return go('#/words');
  if (!FC || !FC.q.length) FC = { q: shuffle(keys), i: 0, rev: false, ok: 0 };
  var k = FC.q[FC.i], e = DICT[k];
  if (!e) { FC.q.splice(FC.i, 1); return vFC(); }
  var b = '<div class="prog"><i style="width:' + Math.round(FC.i / FC.q.length * 100) + '%"></i></div>' +
    '<div class="card fc"><div><div class="big">' + (e.gender ? e.gender + ' ' : '') + esc(e.lemma) + '</div>' +
    (FC.rev ? '<div class="rev">' + esc(e.en) + '<br><i>' + esc(e.ur) + '</i>' +
      (e.ex ? '<div class="small" style="margin-top:12px">' + esc(e.ex.de) + '</div>' : '') + '</div>'
      : '<div class="rev">Tippe zum Umdrehen</div>') + '</div></div>';
  b += '<div class="btns"><button class="btn sec" data-act="sayw" data-t="' + esc(e.lemma) + '">🔊</button>' +
    (FC.rev ? '<button class="btn sec" data-act="fcno">Nochmal</button><button class="btn" data-act="fcok">Gewusst ✓</button>'
      : '<button class="btn" data-act="fcflip">Umdrehen</button>') + '</div>';
  view({ title: 'Karteikarten', sub: (FC.i + 1) + ' / ' + FC.q.length, body: b, back: 1, chip: S.level });
}

/* ---------------- search ---------------- */
function vSearch(q) {
  q = q || '';
  var b = '<input class="inp" id="sq" placeholder="Suchen: Deutsch, English, Roman Urdu…" value="' + esc(q) + '" autocomplete="off">';
  var n = plain(q);
  if (n.length >= 2) {
    var res = [];
    TOPICS.forEach(function (t) {
      t.subtopics.forEach(function (s) {
        LEVELS.forEach(function (lv) {
          var d = s.dialogues && s.dialogues[lv]; if (!d) return;
          d.lines.forEach(function (l) {
            if (plain(l.de).indexOf(n) > -1 || plain(l.en).indexOf(n) > -1 || plain(l.ur).indexOf(n) > -1) {
              if (res.length < 40) res.push({ t: t, s: s, lv: lv, l: l });
            }
          });
        });
      });
    });
    var wres = [];
    for (var k in DICT) {
      var e = DICT[k];
      if (plain(e.lemma).indexOf(n) > -1 || plain(e.en).indexOf(n) > -1 || plain(e.ur).indexOf(n) > -1) {
        if (wres.length < 20) wres.push(k);
      }
    }
    if (wres.length) {
      b += '<div class="sec">Wörter</div><div class="card">';
      wres.forEach(function (k) {
        var e = DICT[k];
        b += '<div class="wc"><div class="g"><div class="l">' + (e.gender ? e.gender + ' ' : '') + esc(e.lemma) + '</div>' +
          '<div class="m">' + esc(e.en) + ' · ' + esc(e.ur) + '</div></div>' +
          '<button class="mini" data-act="star" data-k="' + esc(k) + '">' + (SAVED[k] ? '★' : '☆') + '</button></div>';
      });
      b += '</div>';
    }
    if (res.length) {
      b += '<div class="sec">Sätze (' + res.length + ')</div><div class="rowlist">';
      res.forEach(function (r) {
        b += '<button class="row" data-go="#/d/' + r.t.id + '/' + r.s.id + '">' +
          '<div class="g"><div class="t" style="font-weight:500">' + esc(r.l.de) + '</div>' +
          '<div class="s">' + esc(r.t.title.de) + ' · ' + esc(r.s.title.de) + ' · ' + r.lv + '</div></div><div class="ar">›</div></button>';
      });
      b += '</div>';
    }
    if (!res.length && !wres.length) b += '<div class="empty"><span class="em">🔍</span>Nichts gefunden.</div>';
  }
  view({ title: 'Suche', body: b, chip: S.level });
  var el = document.getElementById('sq');
  if (el) {
    el.focus(); el.setSelectionRange(el.value.length, el.value.length);
    var tmr = null;
    el.oninput = function () { clearTimeout(tmr); tmr = setTimeout(function () { vSearch(el.value); }, 220); };
  }
}

/* ---------------- settings ---------------- */
function vSet() {
  function sw(label, sub, act, on) {
    return '<div class="sw"><div><div style="font-weight:600">' + label + '</div>' +
      (sub ? '<div class="small muted">' + sub + '</div>' : '') + '</div>' +
      '<button class="tog' + (on ? ' on' : '') + '" data-act="' + act + '"><i></i></button></div>';
  }
  var b = '<div class="sec">Niveau</div><div class="levels">';
  LEVELS.forEach(function (l) {
    b += '<button class="lv' + (S.level === l ? ' on' : '') + '" data-act="setlvl" data-l="' + l + '">' + l + '<span class="n">' + esc(LVNAME[l]) + '</span></button>';
  });
  b += '</div>';
  b += '<div class="sec">Übersetzung</div><div class="card">' +
    sw('English', 'Show English translation', 'tgen', S.en) +
    sw('Roman Urdu', 'Roman Urdu tarjuma dikhayein', 'tgur', S.ur) + '</div>';
  b += '<div class="sec">Sprache &amp; Ton</div><div class="card">' +
    sw('Mikrofon im Rollenspiel', hasMic() ? 'Braucht Internet' : 'Auf diesem Browser nicht verfügbar', 'tgmic', S.mic && hasMic()) +
    '<div class="sw"><div><div style="font-weight:600">Sprechtempo</div><div class="small muted">' + S.rate + '×</div></div>' +
    '<input type="range" min="0.5" max="1.2" step="0.05" value="' + S.rate + '" id="rate" style="width:140px"></div></div>';

  b += '<div class="sec">Stimme / Voice</div>';
  if (!VOICES.length) {
    b += '<div class="card" style="padding:14px"><div class="small muted">Es wurde keine deutsche Stimme gefunden. Installiere eine (siehe unten) und öffne die App neu.</div></div>';
  } else {
    b += '<div class="card">';
    VOICES.forEach(function (v) {
      var id = voiceId(v), on = VOICE && voiceId(VOICE) === id;
      b += '<div class="wc"><button style="text-align:left;flex:1;background:none" data-act="setvoice" data-v="' + esc(id) + '">' +
        '<div class="l"' + (on ? ' style="color:var(--acc)"' : '') + '>' + (on ? '● ' : '') + esc(v.name) + '</div>' +
        '<div class="m">' + esc(v.lang) + (v.localService ? ' · offline' : ' · online, natürlicher') + '</div></button>' +
        '<button class="mini" data-act="testvoice" data-v="' + esc(id) + '">🔊</button></div>';
    });
    b += '</div>';
  }
  b += '<div class="livehint" style="text-align:left;margin-top:10px">Klingt die Stimme künstlich? Lade eine bessere deutsche Stimme — sie ist kostenlos, nur nicht vorinstalliert:' +
    '<br>• <b>iPhone</b>: Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen → Deutsch → eine mit „Premium" oder „Erweitert" laden.' +
    '<br>• <b>Android</b>: Einstellungen → Zusätzliche Einstellungen → Sprache → Text-in-Sprache → Google → Deutsch, „Hohe Qualität" installieren.' +
    '<br>Danach die App neu öffnen und die Stimme oben auswählen.</div>';
  b += '<div class="sec">KI-Gespräch (frei sprechen)</div><div class="card" style="padding:14px">';
  b += '<div class="small muted" style="margin-bottom:12px">Optional. Damit antwortet die App wie eine echte Person und spricht natürlicher. Ein Elternteil richtet das einmal ein (kostenlos) und gibt euch dann nur die Adresse und das Passwort zum Eintragen.</div>';
  b += '<div style="font-weight:600;font-size:13px">Server-Adresse (URL)</div>' +
    '<input class="inp" id="aiurl" placeholder="https://…workers.dev" value="' + esc(S.aiUrl || '') + '" autocomplete="off" spellcheck="false" style="margin:6px 0 12px">';
  b += '<div style="font-weight:600;font-size:13px">Familien-Passwort</div>' +
    '<input class="inp" id="aikey" placeholder="euer geheimes Wort" value="' + esc(S.aiKey || '') + '" autocomplete="off" spellcheck="false" style="margin:6px 0 4px">';
  b += sw('KI-Stimme überall', 'Natürliche Stimme für alle Gespräche und Wörter. Aus = Gerätestimme.', 'tgaivoice', S.aiVoice);
  b += '<div class="livehint" style="text-align:left;margin:4px 0 8px">Jede Zeile wird nur einmal geladen und dann dauerhaft gespeichert — danach ist sie sofort da und funktioniert auch offline.</div>';
  b += '<div class="btns" style="margin-top:6px"><button class="btn sec" data-act="aitest">Verbindung testen</button>' +
    '<button class="btn sec" data-act="clearcache">Ton-Cache leeren</button></div>';
  b += '<div id="aistat" class="small" style="margin-top:8px"></div>';
  b += '</div>';

  b += '<div class="sec">Aussehen</div><div class="card"><div class="sw"><div style="font-weight:600">Theme</div><div style="display:flex;gap:6px">' +
    ['auto', 'light', 'dark'].map(function (t) {
      return '<button class="mini' + (S.theme === t ? ' sel' : '') + '" data-act="theme" data-t="' + t + '" style="' +
        (S.theme === t ? 'background:var(--acc);color:#fff' : '') + '">' + t + '</button>';
    }).join('') + '</div></div></div>';
  b += '<div class="sec">Daten</div><div class="card"><button class="sw" style="width:100%" data-act="reset">' +
    '<div style="text-align:left"><div style="font-weight:600;color:var(--bad)">Fortschritt löschen</div>' +
    '<div class="small muted">Wörter, Ergebnisse, gelesene Gespräche</div></div><div class="ar">›</div></button></div>';
  b += '<p class="small muted center" style="margin-top:20px">Deutsch Alltag · offline · ' + TOPICS.length + ' Themen · ' + Object.keys(DICT).length + ' Wörter</p>';
  view({ title: 'Einstellungen', body: b, chip: S.level });
  var r = document.getElementById('rate');
  if (r) r.oninput = function () { S.rate = Number(r.value); saveSet(); };
  var au = document.getElementById('aiurl');
  if (au) au.oninput = function () { S.aiUrl = au.value.trim(); ss('set', S); };
  var ak = document.getElementById('aikey');
  if (ak) ak.oninput = function () { S.aiKey = ak.value.trim(); ss('set', S); };
}

/* ---------------- router ---------------- */
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function route() {
  closeSheet();
  stopAudio();               // stop any playing speech (device or cached AI) on navigation
  if (RP) rpStopLive(true);  // stop any live audio/mic when leaving the roleplay
  var p = (location.hash || '#/').replace(/^#\/?/, '').split('/');
  if (!p[0]) return vHome();
  if (p[0] === 't') return vTopic(p[1]);
  if (p[0] === 'd') return vDialogue(p[1], p[2]);
  if (p[0] === 'rp') { vRoleplay(p[1], p[2]); rpStart(); return; }
  if (p[0] === 'test') return vTest(p[1]);
  if (p[0] === 'words') return vWords();
  if (p[0] === 'fc') return vFC();
  if (p[0] === 'search') return vSearch('');
  if (p[0] === 'set') return vSet();
  return vHome();
}
window.addEventListener('hashchange', route);

/* ---------------- events ---------------- */
document.addEventListener('click', function (ev) {
  var el = ev.target.closest ? ev.target.closest('[data-act],[data-go],.w,.bub') : null;
  if (!el) return;
  var act = el.getAttribute('data-act');
  var goh = el.getAttribute('data-go');

  if (el.classList.contains('w')) {
    ev.stopPropagation();
    openWord(el.getAttribute('data-w'), el.getAttribute('data-li'));
    return;
  }
  if (goh) { go(goh); return; }

  switch (act) {
    case 'back': history.back(); return;
    case 'lvl': levelSheet(); return;
    case 'setlvl':
      S.level = el.getAttribute('data-l'); saveSet(); closeSheet(); route(); return;
    case 'sayw': speakAuto(el.getAttribute('data-t')); return;
    case 'sayline': speakAuto(LINES[el.getAttribute('data-i')].de); return;
    case 'tr': {
      var bub = el.closest('.bub'); if (bub) bub.classList.toggle('open'); return;
    }
    case 'playall': {
      var i = 0;
      (function nxt() { if (i >= LINES.length) return; speakAuto(LINES[i++].de, function () { setTimeout(nxt, 150); }); })();
      return;
    }
    case 'star': case 'unstar': {
      var k = el.getAttribute('data-k');
      if (SAVED[k]) delete SAVED[k]; else SAVED[k] = { t: Date.now(), box: 0 };
      saveWords();
      if (act === 'unstar') { route(); }
      else { el.textContent = SAVED[k] ? '★' : '☆'; }
      return;
    }
    /* roleplay */
    case 'rpsend': { var i2 = document.getElementById('rpin'); var v = i2 ? i2.value : ''; if (i2) i2.value = ''; rpDeliver(v); return; }
    case 'rppick': rpDeliver(el.getAttribute('data-o')); return;
    case 'rphelp': RP.showOpts = !RP.showOpts; rpRender(false); return;
    case 'rpstartlive': rpBeginLive(); return;
    case 'rpstartai': rpBeginAi(); return;
    case 'rporbtap': rpOrbTap(); return;
    case 'rplivestop': case 'rptype': rpStopLive(false); return;
    case 'rprep': {
      stopAudio();
      for (var j = RP.log.length - 1; j >= 0; j--) if (!RP.log[j].me) { speakAuto(RP.log[j].text); break; }
      return;
    }
    case 'rpagain': vRoleplay(RP.t.id, RP.s.id); rpStart(); return;
    /* test */
    case 'tpick': if (T.state !== 'done') { T.pick = Number(el.getAttribute('data-i')); tRender(); } return;
    case 'tbuild': T.built.push(Number(el.getAttribute('data-i'))); tRender(); return;
    case 'tunbuild': T.built.splice(Number(el.getAttribute('data-i')), 1); tRender(); return;
    case 'tcheck': tCheck(); return;
    case 'tnext': T.i++; T.state = 'ask'; T.pick = null; T.built = []; tRender(); return;
    case 'tagain': vTest(T.t.id); return;
    /* flashcards */
    case 'fcflip': FC.rev = true; vFC(); return;
    case 'fcok': case 'fcno':
      if (act === 'fcok') FC.ok++;
      FC.i++; FC.rev = false;
      if (FC.i >= FC.q.length) { FC = null; go('#/words'); } else vFC();
      return;
    /* settings */
    case 'tgen': S.en = !S.en; saveSet(); vSet(); return;
    case 'tgur': S.ur = !S.ur; saveSet(); vSet(); return;
    case 'tgmic': S.mic = !S.mic; saveSet(); vSet(); return;
    case 'setvoice': S.voice = el.getAttribute('data-v'); saveSet(); pickVoice(); vSet(); sampleVoice(S.voice); return;
    case 'testvoice': sampleVoice(el.getAttribute('data-v')); return;
    case 'tgaivoice': S.aiVoice = !S.aiVoice; saveSet(); vSet(); return;
    case 'clearcache': {
      var cs = document.getElementById('aistat');
      if (cs) { cs.textContent = 'Ton-Cache wird geleert…'; cs.style.color = 'var(--tx2)'; }
      ttsClear().then(function () { if (cs) { cs.textContent = '✓ Ton-Cache geleert.'; cs.style.color = 'var(--ok)'; } });
      return;
    }
    case 'aitest': {
      var st = document.getElementById('aistat');
      if (!aiConfigured()) { if (st) { st.textContent = 'Bitte URL und Passwort eingeben.'; st.style.color = 'var(--bad)'; } return; }
      if (st) { st.textContent = 'Teste…'; st.style.color = 'var(--tx2)'; }
      aiFetch('/ping', {}).then(function () { if (st) { st.textContent = '✓ Verbindung OK — du kannst frei sprechen.'; st.style.color = 'var(--ok)'; } })
        .catch(function (e) { if (st) { st.textContent = '✗ ' + e.message; st.style.color = 'var(--bad)'; } });
      return;
    }
    case 'theme': S.theme = el.getAttribute('data-t'); saveSet(); vSet(); return;
    case 'reset':
      if (confirm('Wirklich allen Fortschritt löschen?')) {
        SAVED = {}; PROG = { read: {}, test: {}, rp: {} }; saveWords(); saveProg(); vSet();
      }
      return;
    case 'closesheet': closeSheet(); return;
  }

  var bub2 = ev.target.closest('.bub');
  if (bub2) bub2.classList.toggle('open');
});
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Enter') return;
  if (document.getElementById('rpin') === document.activeElement) { ev.preventDefault(); rpAnswer(document.getElementById('rpin').value); }
  else if (document.getElementById('tin') === document.activeElement) { ev.preventDefault(); if (T && T.state !== 'done') tCheck(); else if (T) { T.i++; T.state = 'ask'; T.pick = null; T.built = []; tRender(); } }
});
document.getElementById('scrim').addEventListener('click', closeSheet);

route();
})();
