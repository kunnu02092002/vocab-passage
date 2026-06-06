# Vocab Passage Generator — Plan

## Overview
A single-page HTML web app that extracts N3 vocabulary from a PDF, randomly selects 50 words, and generates a Japanese reading passage using those words via Groq API. Features parallel the existing kanji-reading-practice app.

---

## 1. Project Structure

```
vocab-passage/
├── extract_n3_vocab.py          # One-time Python script to parse PDF → JSON
├── n3_vocab.json                 # Output: ~780 N3 vocab entries
├── index.html                    # Single-page app (the main deliverable)
├── netlify.toml                  # Netlify config (root redirect + functions)
├── netlify/
│   └── functions/
│       └── groq.mjs              # Serverless Groq proxy (same as kanji project)
└── .gitignore
```

---

## 2. Step 1: Extract Vocab from PDF (`extract_n3_vocab.py`)

### Input
- `/Users/kunaltale/Desktop/VocabList.N3.pdf`
- Table structure: 3 columns — **Kanji** | **Hiragana** | **English**
- Some rows have missing Kanji (e.g. `あっ` has no kanji)
- Some rows have multiple readings (e.g. `得る` = `える` / `うる`)
- ~780 entries total

### Approach
Use `tabula-py` (table extraction library). Handle edge cases:
- Rows with empty Kanji → store kanji as empty string
- Rows with multiple comma-separated kanji → keep as single entry (e.g. `得る える/うる to get` → one entry with both readings stored)
- Skip header rows and page footers

### Output: `n3_vocab.json`
```json
[
  {"kanji": "愛", "hiragana": "あい", "english": "love"},
  {"kanji": "挨拶", "hiragana": "あいさつ", "english": "greeting"},
  {"kanji": "", "hiragana": "あっ", "english": "Ah!,Oh!"},
  {"kanji": "得る", "hiragana": "える", "english": "to get,to gain,to win", "alt_hiragana": "うる"},
  ...
]
```

### Installation
```bash
pip install tabula-py
```

---

## 3. Step 2: Build the Web App (`index.html`)

### Architecture
Single HTML file (like kanji-reading-practice.html):
- Inline CSS for styling
- Inline JS for logic
- Loads `n3_vocab.json` via `fetch()` on page load
- Uses same Groq proxy endpoint and Netlify setup

### UI Layout

```
┌─────────────────────────────────────────────────┐
│  [Title]                           [JLPT ▼]     │
│  Subtitle                        [Generate ▼]   │
├──────────────────┬──────────────────────────────┤
│  Control Panel   │  Reader Area                 │
│                  │                              │
│  Level: N3 ▼     │  [Vocab Strip: 50 chips]     │
│                  │                              │
│  [ Generate ]    │  [Passage text with          │
│                  │   ruby furigana on vocab]     │
│  Furigana: ON/OFF│                              │
│                  │  ─── divider ───             │
│  Status:         │                              │
│  48/50 found     │  [English translation]       │
│                  │                              │
│  Library: 0/50   │                              │
└──────────────────┴──────────────────────────────┘
```

### Key Features from Kanji App (Reuse Same Pattern)
- ✅ Paragraph-by-paragraph audio playback (click to play)
- ✅ Pause/Resume button (⏸/▶)
- ✅ Gold highlight on current speech paragraph
- ✅ Fullscreen reading mode
- ✅ Copy button
- ✅ Save to library (localStorage)
- ✅ Library grid view (saved generations)
- ✅ Netlify deployment with Groq proxy

### Key Differences from Kanji App

#### Vocab Strip Chips
Each chip shows: **Kanji** with small **hiragana** above (like `<ruby>`):
```
 あい
 愛
```
- Found words get gold background
- Not-found words stay gray
- On hover/tap: show full english meaning in a tooltip/popup

#### Furigana Toggle
- A toggle switch in the control panel: **Furigana: ON / OFF**
- When ON: vocab words in the passage get `<ruby>` tags with hiragana reading above
- When OFF: vocab words appear as plain text without readings
- The kanji app already has furigana rendering — we adapt it to use our vocab data instead of regex-based detection
- **Implementation**: The LLM returns furigana notation `(reading)` in the response. We cross-reference against our vocab list to add ruby annotations. The toggle controls whether we render them.

#### Vocab Selection Logic
```
Load n3_vocab.json (780 entries) on page load
When user clicks "Generate":
  1. Shuffle all vocab entries
  2. Pick first 50
  3. Show them in the strip
  4. Build prompt with these 50 words
  5. Send to Groq
  6. Render result
  7. Highlight found/not-found in strip
  8. Show count: "48/50 used"
```

#### "Regenerate" Button
- **Regenerate**: Keeps same 50 words, sends prompt again (in case generation was poor)
- **New Words**: Picks a fresh random 50

### Prompt Engineering
```
You are a Japanese language teacher. Write a long connected passage at N3 level 
that naturally incorporates the following 50 vocabulary words:

[list of vocab with readings]

Rules:
- Use every word at least once; if too many, use at least 90%
- Naturally weave the words into a coherent passage
- Add furigana in the format 愛(あい) for vocabulary words
- Keep grammar and vocabulary strictly at N3 level
- Write 4-6 Japanese paragraphs
- After the Japanese text, add "---" divider, then a full English translation
```

### Furigana Rendering
When generating, the LLM is instructed to output furigana like `愛(あい)` for vocab words. The rendering code:
1. Splits the text at each `kanji(hiragana)` pattern
2. Wraps each match in `<ruby>愛<rt>あい</rt></ruby>`
3. The toggle button controls whether `<ruby>` tags are rendered or stripped

For vocab words that appear WITHOUT explicit furigana from the LLM, we look up the word in our `n3_vocab.json` by kanji and inject the reading if the furigana toggle is on.

### Audio Controls
- Same as kanji app: paragraph-by-paragraph speech via `speechSynthesis`
- Pause/Resume button
- Click any paragraph to start speaking from there
- Gold highlight on current speech paragraph

---

## 4. Step 3: Netlify Deployment

### Files (same as kanji project)
- `netlify/functions/groq.mjs` — identical serverless Groq proxy
- `netlify.toml` — root redirect to `index.html`

### Environment Variable
- `GROQ_API_KEY` = your Groq API key (same one)

### To Deploy
1. Push to new GitHub repo
2. Import to Netlify
3. Add `GROQ_API_KEY` env var
4. Deploy

---

## 5. Data Flow Summary

```
[PDF] ──extract_n3_vocab.py──▶ [n3_vocab.json] ──▶ [index.html]
                                                       │
                                              On "Generate":
                                                       │
                                              Pick 50 random
                                                       │
                                              Build prompt ──▶ [Groq API via /netlify/functions/groq.mjs]
                                                       │
                                              Parse response (Japanese + English)
                                                       │
                                              Render with furigana (if toggle ON)
                                                       │
                                              Highlight found/not-found chips
                                                       │
                                              [User can play audio, save, copy]
```

---

## 6. Questions Answered

| Question | Decision |
|----------|----------|
| Furigana position | Above the kanji in small text (ruby annotations) |
| Furigana toggle | ON/OFF switch in control panel |
| Vocab per passage | 50 (with Regenerate + New Words buttons) |
| Library | Same localStorage pattern as kanji app |
| Repository | Separate repo (user will provide) |

---

## 7. Implementation Order

1. Create `extract_n3_vocab.py` → run once → produce `n3_vocab.json`
2. Copy `netlify.toml` and `netlify/functions/groq.mjs` from kanji project
3. Build `index.html`:
   - Layout and CSS (adapted from kanji app)
   - Load `n3_vocab.json` on init
   - Vocab selection logic (random 50)
   - Prompt building
   - Response parsing + furigana rendering
   - Toggle furigana ON/OFF
   - Vocab strip with found/not-found highlighting
   - Audio controls (same as kanji app)
   - Save/load library
4. Test locally with `python3 -m http.server 8000`
5. Deploy to Netlify