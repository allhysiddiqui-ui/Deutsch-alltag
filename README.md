# Deutsch Alltag

Offline German learning app. One self-contained HTML file — copy `dist/deutsch.html`
anywhere (phone, laptop, USB stick) and open it in any browser. No internet, no install.

## Use it

Open `dist/deutsch.html`. On a phone: copy the file over, open it from Files/Downloads,
then "Add to Home Screen" if you want an icon.

- **Level A1–B2** — each subtopic has four separately written conversations for the same
  situation. Same scene, different sentence structure and vocabulary.
- **Tap any German word** → gender, plural, verb forms, English, Roman Urdu, example sentence.
- **Tap a bubble** → full-line translation. 🔊 speaks it (offline, built into the phone).
- **Rollenspiel** — the app plays the other person and you answer by typing, by voice, or by
  picking from options. Voice input needs internet (Chrome/Edge/Safari); typing always works.
- **Test** per topic — multiple choice, gap fill, word-order tiles, dictation, translation.
  Wrong answers are starred into your flashcards automatically.

## Change the content

```
content/
  dictionary.*.json          every word, merged into one dictionary at build time
  topics/kinderarzt/
    _topic.json              topic meta + the written test
    01-termin.json …         one file per subtopic (4 levels + roleplay each)
src/       app.html  app.css  app.js
tools/     build.mjs  validate.mjs
dist/      deutsch.html      <- the file you share
```

Rebuild after any edit:

```bash
node tools/build.mjs
```

The build **fails** if any word in any dialogue has no dictionary entry — that is what keeps
"every word is tappable" true. It prints the missing words as ready-to-paste JSON stubs.
To check without building:

```bash
node tools/validate.mjs
```

Inflected forms live on the lemma (`"forms": ["hat","hatte","gehabt"]`), so one entry covers
a whole verb. Per-line overrides (`"w": {"Schloss": "schloss-gebäude"}`) handle words whose
meaning depends on context.

## Status

- **Beim Kinderarzt** — 5 subtopics × 4 levels = 20 conversations, 352 lines,
  10 roleplay scripts, 22 test items, 817 dictionary entries.
- Next topics planned in [PLAN.md](PLAN.md).
