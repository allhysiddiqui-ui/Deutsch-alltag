# Deutsch Alltag — offline German learning app

## Goal
A mobile-friendly HTML app that runs fully local (single file, openable from any device),
teaching everyday German conversation. Translations in English + Roman Urdu. Level A1–B2.
Tap any word for meaning + example. Per-topic written test and spoken roleplay test.

## Decisions (locked)
- **Urdu**: Roman Urdu only (`shelf, raik`) — no Nastaliq font dependency, searchable, types anywhere.
- **Levels**: A1 / A2 / B1 / B2 are four *separately written* long conversations for the same
  situation. Same scenario, different sentence structure and vocabulary. Not a filter.
- **Delivery**: one self-contained `dist/deutsch.html` (all CSS/JS/content inlined). `file://`
  blocks `fetch()`, so nothing may be loaded at runtime. Optional PWA deploy for URL access.
- **Build**: Node v24 present. `node tools/build.mjs` inlines content; `tools/validate.mjs` fails
  the build if any dialogue token has no dictionary entry.

## Screens
1. Home — level badge, topic grid, search, My Words, progress.
2. Topic — subcategory list + "Test" and "Roleplay" buttons.
3. Dialogue — chat bubbles, German only; tap bubble = EN/Roman-Urdu; 🔊 per line.
4. Word sheet (bottom sheet) — lemma, gender+plural / verb forms, POS, EN, Roman Urdu,
   example sentence with translations, ⭐ save.
5. Written test — auto-graded, weak items pushed to flashcards.
6. Roleplay — app plays the other person, branching script, voice or typed answers.
7. Settings — level, show EN / UR / both, dark mode, speech rate, mic on/off.

## Data model
```jsonc
// content/topics/restaurant.json
{ "id":"restaurant", "icon":"🍽",
  "title":{"de":"Im Restaurant","en":"At the restaurant","ur":"restaurant mein"},
  "subtopics":[
    { "id":"bestellen", "angle":"Ordering food and drinks",
      "dialogues":{
        "A1":{"lines":[{"s":"K","de":"Ich möchte eine Suppe, bitte.",
                        "en":"I would like a soup, please.",
                        "ur":"mujhe ek soup chahiye, please.",
                        "w":{"Suppe":"suppe"}}]},
        "A2":{...},"B1":{...},"B2":{...}
      },
      "roleplay":{...}, "test":{...} } ] }
```
```jsonc
// content/dictionary.json
"suppe":{ "lemma":"Suppe","pos":"noun","gender":"die","plural":"Suppen",
          "en":"soup","ur":"soup, shorba",
          "ex":{"de":"Die Suppe ist zu heiß.","en":"The soup is too hot.",
                "ur":"soup bohat garam hai."} }
```
Tap resolution order: per-line `w` override → dictionary exact → inflection map
(`ging`/`geht` → `gehen`) → miss (build should make misses impossible).

## Written test (per topic)
- DE → EN/Roman-Urdu multiple choice
- fill the gap in a line from the dialogues
- word-tile sentence ordering (drag/tap to build correct word order)
- listening: TTS speaks, you type what you heard
- production: EN/Roman-Urdu prompt → type the German
Auto-graded, score in localStorage, wrong items auto-starred into flashcards.

## Roleplay ("app becomes a person")
Per subtopic, a branching script keyed to the level. App plays the counterpart
(waiter, doctor, landlord), speaks via TTS, and shows an English/Roman-Urdu prompt
of what you should express. You answer by:
1. **Voice** — Web Speech API recognition (`de-DE`), if available
2. **Typing** — always available
3. **Choose from 3 options** — always available, for A1

Matching engine (pure local): normalize → required-keyword sets per accepted answer →
token-overlap + Levenshtein fuzzy score → grade `good / understandable / off` → branch.
Each node has 2–4 accepted answers and a fallback ("Wie bitte?") that re-asks, so the
conversation adapts instead of dead-ending. End of scene = short feedback card.

**Honest constraint**: browser speech *recognition* (mic → text) needs internet on Chrome,
Edge and iOS Safari — audio is transcribed on the vendor's servers. Firefox has none.
Text-to-speech (app talking) *is* offline. So: offline = read, listen, test, roleplay by typing.
Online = roleplay by voice too. A truly free-form AI partner would need an API key; can be
added later as an optional online mode.

## Repo layout
```
german-app/
  src/       app.html  app.css  app.js
  content/   dictionary.json  topics/*.json
  tools/     build.mjs  validate.mjs
  dist/      deutsch.html      <- the file you copy to your phone
```

## Content scope
14 topics × ~5 subtopics × 4 long dialogues (15–20 lines) ≈ 280 dialogues,
~2,500 dictionary entries, 70 roleplay scripts, 14 topic tests.
Built in batches, not in one pass.

Topics: Greetings & Smalltalk · Supermarket & Shopping · Restaurant & Café ·
Transport & Travel · Doctor & Pharmacy · Housing & Landlord · Work & Job interview ·
Amt / Bureaucracy · Bank & Money · School & Studying · Phone/Internet/Contracts ·
Free time & Hobbies · Family & Friends · Emergencies & Problems

## Phases
1. Engine + build + validator + **Restaurant** topic complete at all 4 levels,
   with its test and roleplay. Test on phone, gather feedback.
2. Adjust from feedback, then content in batches of 2–3 topics.
3. Flashcard review, global search, PWA manifest + service worker, optional deploy.
