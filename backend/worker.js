/*
 * Deutsch Alltag — free backend (Cloudflare Worker)
 * ---------------------------------------------------
 * Holds the Google Gemini API key SECRETLY so it never appears in the public app.
 * The app calls this Worker; the Worker calls Gemini and returns the result.
 *
 * Two secrets are set in the Cloudflare dashboard (NOT in this file):
 *   GEMINI_KEY  — your free Google AI Studio key
 *   APP_PASS    — a family passphrase; the app must send it, so strangers with the
 *                 public URL can't burn your free quota
 *
 * Endpoints (all POST):
 *   /ping  -> {ok:true}                     (connection test)
 *   /chat  -> {reply:"..."}                 (the conversation brain)
 *   /tts   -> {audio:"<base64 wav>", mime}  (natural voice)
 */

const CHAT_MODEL = 'gemini-2.0-flash';               // strong German, fast, free tier
const TTS_MODEL  = 'gemini-2.5-flash-preview-tts';   // natural voice; if it errors, the app falls back to the device voice
const TTS_VOICE  = 'Kore';                            // a Gemini prebuilt voice

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Pass',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') return reply({ error: 'POST only' }, 405, cors);

    const pass = req.headers.get('X-App-Pass') || '';
    if (!env.APP_PASS || pass !== env.APP_PASS) return reply({ error: 'Falsches Passwort.' }, 401, cors);
    if (!env.GEMINI_KEY) return reply({ error: 'GEMINI_KEY fehlt im Worker.' }, 500, cors);

    const path = new URL(req.url).pathname;
    let body = {};
    try { body = await req.json(); } catch (e) {}

    try {
      if (path.endsWith('/ping')) return reply({ ok: true }, 200, cors);
      if (path.endsWith('/chat')) return reply(await chat(body, env), 200, cors);
      if (path.endsWith('/tts'))  return reply(await tts(body, env), 200, cors);
      return reply({ error: 'unknown path' }, 404, cors);
    } catch (e) {
      return reply({ error: String((e && e.message) || e) }, 502, cors);
    }
  },
};

function reply(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}

async function chat(body, env) {
  const history = Array.isArray(body.history) ? body.history : [];
  const contents = history.map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(m.text || '') }],
  }));
  const payload = {
    contents,
    generationConfig: { temperature: 0.75, maxOutputTokens: 220 },
  };
  if (body.system) payload.systemInstruction = { parts: [{ text: String(body.system) }] };

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${env.GEMINI_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || 'chat failed');
  const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  return { reply: text };
}

async function tts(body, env) {
  const text = String(body.text || '').slice(0, 600);
  const payload = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
    },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${env.GEMINI_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
  );
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || 'tts failed');
  const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
  const audio = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!audio) throw new Error('no audio');
  // Gemini returns raw PCM (16-bit, 24 kHz, mono) — wrap it in a WAV so a browser can play it.
  return { audio: pcmToWav(audio.inlineData.data, 24000), mime: 'audio/wav' };
}

function pcmToWav(b64, rate) {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new ArrayBuffer(44 + len);
  const dv = new DataView(buf);
  const put = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  put(0, 'RIFF'); dv.setUint32(4, 36 + len, true); put(8, 'WAVE'); put(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  put(36, 'data'); dv.setUint32(40, len, true);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < len; i++) bytes[44 + i] = bin.charCodeAt(i);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}
