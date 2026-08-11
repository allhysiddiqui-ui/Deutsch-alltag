# Free AI upgrade — one-time setup

This makes the roleplay a **real conversation partner** (understands anything you say,
replies naturally) with a **natural voice**. It's free (no credit card) and the family
just types in an address + password once.

You do this **once**. Total time ~15 minutes. Two free accounts, no card.

---

## Step 1 — Get a free Google Gemini key (the "brain")

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with any Google account.
3. Click **Create API key** → **Create API key in new project**.
4. Copy the key (a long string starting with `AIza…`). Keep it somewhere safe.
   Do **not** put it in the app or share it publicly — it goes only into Step 2.

No credit card is asked. The free tier is plenty for a family.

---

## Step 2 — Put the key behind a free Cloudflare Worker (hides the key)

1. Go to **https://dash.cloudflare.com/sign-up** and create a free account (no card).
2. In the left menu open **Compute (Workers)** → **Workers & Pages** → **Create** →
   **Start with Hello World** → **Deploy**. You now have a Worker with a URL like
   `https://something.YOURNAME.workers.dev`.
3. Click **Edit code**. Delete everything in the editor.
4. Open the file **`backend/worker.js`** from this project, copy **all** of it, and paste
   it into the Cloudflare editor. Click **Deploy** (top right).
5. Add the two secrets: go to the Worker's **Settings** → **Variables and Secrets**
   (older UI: *Settings → Variables*). Add two:
   - Name `GEMINI_KEY`, value = the `AIza…` key from Step 1 → **Encrypt** → Save.
   - Name `APP_PASS`, value = a **family password** you invent (e.g. `khan-familie-2026`) → Save.
6. Deploy once more if it asks.
7. Copy your Worker URL (the `https://….workers.dev` one).

---

## Step 3 — Turn it on in the app

Do this on each phone (or just yours to test first):

1. Open the app → **Mehr (⚙️)** → scroll to **KI-Gespräch (frei sprechen)**.
2. **Server-Adresse (URL)**: paste your Worker URL.
3. **Familien-Passwort**: type the same `APP_PASS` you set in Step 2.
4. Tap **Verbindung testen** → it should say **✓ Verbindung OK**.
5. Open any roleplay → tap **🤖 Frei sprechen mit KI** and talk.

Share the **URL + password** with family so they fill in the same two boxes. They never
see the Google key — it stays inside the Worker.

---

## Notes

- **Free limits:** Gemini's free tier has daily caps. Fine for a family; if it ever stops,
  it resets the next day.
- **Voice:** "KI-Stimme verwenden" (on by default) uses the AI voice. If it sounds off or
  hits a limit, turn it off and the app uses your phone's (enhanced) voice instead — the
  conversation still works.
- **Needs internet.** The normal reading, word taps, tests and scripted roleplay stay offline.
- **If the test fails:** re-check the URL (no spaces), the password matches exactly, and that
  both secrets are saved in the Worker. The error message from **Verbindung testen** usually
  says what's wrong (e.g. "Falsches Passwort", or a Google quota message).
