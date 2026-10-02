# 🌱 PhytoState

**Timed-Automaton Verification Engine for AI-Driven Crop Growth Monitoring**

PhytoState watches a crop's lifecycle the way a verification engineer would: every observation
(a photo of the plant + how many days it has been in its current stage) is fed to a **timed
automaton** — a state machine that knows not only *which* stage must come next, but *how long*
each stage is allowed to last. If the observed lifecycle is biologically impossible — a stage
skipped, the plant regressing, a harvest claimed before the seed ever germinated — PhytoState
catches it and explains exactly which rule was broken.

Built as a hackathon project: one Flask process, zero build step, zero JavaScript dependencies,
fully server-rendered.

---

## Why this exists

Growth-stage data drives real decisions — irrigation, fertilization, harvest logistics. But that
data is produced by fallible pipelines: classifiers mislabel photos, sensors drop frames, manual
entries get fat-fingered. A single impossible record ("this seedling flowered yesterday, and
germinated today") can silently corrupt an entire monitoring dashboard.

PhytoState inserts a **formal verification layer between the model and the consumer**:

```
                ┌──────────────────────── PhytoState (single Flask process) ────────────────────────┐
                │                                                                                   │
 crop photo ────┼─▶ POST /predict ─▶ predictor.py ─▶ growth stage ─┐                                │
 + days         │         │                          (SEED…HARVEST) ├─▶ automaton.py                │
                │         │                                   days ─┘   verify_sequence()           │
                │         │                                        │                                │
                │         │                                        ├─ ✔ accepted  → logged          │
                │         │                                        └─ ✘ rejected  → rule violations │
                │         ▼                                                                         │
                │   dashboard: sequence timeline · dwell-time ledger · automaton state · verdicts    │
                └───────────────────────────────────────────────────────────────────────────────────┘
```

The verification engine never edits or "fixes" the data — it **accepts or rejects with reasons**,
which is exactly what you want from a safety layer.

---

## The lifecycle model

Six stages, strictly ordered:

```
SEED ──[1–3 d]──▶ GERMINATION ──[2–5 d]──▶ VEGETATIVE ──[3–8 d]──▶ FLOWERING ──[2–5 d]──▶ FRUITING ──[3–7 d]──▶ HARVEST (terminal)
```

Every stage carries a **dwell-time window** (minimum and maximum days). A transition is only
timed-valid if it moves forward *exactly one* stage and the previous stage dwelt inside its window.

| Stage | Min days | Max days | Notes |
|---|---|---|---|
| `SEED` | 1 | 3 | |
| `GERMINATION` | 2 | 5 | |
| `VEGETATIVE` | 3 | 8 | longest dwell window |
| `FLOWERING` | 2 | 5 | |
| `FRUITING` | 3 | 7 | |
| `HARVEST` | — | — | terminal; exempt from stagnation checks |

### The five rule classes

| Rule | Trigger | Example engine message |
|---|---|---|
| **Stage skipping** | next stage index > current + 1 | `Stage skipping detected: SEED → FLOWERING` |
| **Backward transition** | next stage index < current | `Backward transition detected: VEGETATIVE → GERMINATION` |
| **Premature transition** | dwell < minimum | `Premature transition: SEED duration is 0 day(s). Minimum required is 1 day(s).` |
| **Abnormal stagnation** | dwell > maximum (HARVEST exempt) | `Abnormal stagnation: VEGETATIVE lasted 10 day(s). Maximum allowed is 8 day(s).` |
| **Incomplete lifecycle** | last logged stage ≠ `HARVEST` | `Lifecycle has not reached HARVEST.` |

A sequence that survives all five checks returns:

```
Sequence and dwell-time constraints accepted by the PhytoState automaton.
```

`automaton.py` is pure Python with **no Flask dependency** — the engine is the product; the web
app is one consumer of it.

---

## Features

- **📷 Stage analysis pipeline** — upload a crop photo + dwell duration; the predictor assigns the
  current growth stage and the automaton instantly verdicts the whole sequence.
- **🛡️ Timed-automaton verification** — transition rules *and* dwell-time rules, each violation
  reported as a human-readable message.
- **⏱️ Dwell-Time Ledger** — every logged stage with its actual duration, allowed window, and a
  computed status pill (`in range` / `premature` / `stagnant` / `terminal`).
- **🧪 Scenario simulator** — five one-click canned lifecycles (skip, backward, premature,
  stagnation, healthy) that replay through the *real* engine, plus a **"Run all 5"** button that
  plays the full test suite as a demo sequence.
- **📷 Camera simulation** — one toggle fast-forwards an entire crop lifecycle: a simulated field
  camera uploads stage-appropriate frames every ~2 seconds and the dashboard grows on its own.
- **📊 Dwell-time Gantt** — each logged stage drawn as a bar against its allowed min–max window;
  premature and stagnant dwells visibly poke outside the band. Rendered with plain CSS, no chart
  library.
- **🚨 Violation highlighting** — engine messages are parsed client-side to light up the exact
  broken transition in the automaton diagram, the guilty timeline stages, and the offending
  ledger rows.
- **📈 Live dashboard** — growth-sequence timeline, lifecycle progress bar, days-elapsed stats,
  and a lifecycle-automaton diagram that lights up logged states.
- **🔄 Session control** — one click resets the growth log and rewinds the predictor's cursor.
- **🖥️ Progressive enhancement** — every interaction works without JavaScript (plain forms and
  links); with JS, content hot-swaps with subtle transition choreography. Respects
  `prefers-reduced-motion`.
- **🧩 Zero build step** — no bundler, no npm, no CDN fonts. System font stack, vanilla CSS/JS.

---

## Quickstart

```bash
# 1. Install dependencies (Flask only)
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Run
python3 app.py

# 3. Open
#    http://127.0.0.1:5000
```

> **Note:** use `python3`, not `python` — on most modern Linux distros `python` doesn't exist or
> points elsewhere.

<details>
<summary><b>Debian/Ubuntu troubleshooting</b> (PEP 668 / ensurepip issues)</summary>

Newer Debian/Ubuntu Python builds are externally managed and may ship without `ensurepip`:

```bash
# If `python3 -m venv venv` fails with "ensurepip is not available":
sudo apt install python3.12-venv        # or: apt install python3-venv

# If pip refuses to install into the venv / system (PEP 668 externally-managed-environment),
# a sudo-free workaround that keeps everything isolated:
python3 -m venv --without-pip venv
curl -sS https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
./venv/bin/python /tmp/get-pip.py
./venv/bin/pip install -r requirements.txt
```

</details>

---

## API reference

All state is held in-process (in-memory). Every route returns the full server-rendered dashboard.

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET` | `/` | — | Dashboard with current sequence, dwell ledger and last verdict |
| `POST` | `/predict` | `multipart/form-data`: `image` (file, required), `duration` (integer days, required) | Stores the photo to `uploads/`, predicts the stage, appends `(stage, duration)` to the log, runs verification |
| `GET` | `/demo/skip` | — | Canned invalid sequence: `SEED → FLOWERING → FRUITING → HARVEST` (skips two stages) |
| `GET` | `/demo/premature` | — | Canned invalid sequence: `SEED` dwells 0 days (below its 1-day minimum) |
| `GET` | `/demo/stagnation` | — | Canned invalid sequence: `VEGETATIVE` dwells 10 days (above its 8-day maximum) |
| `GET` | `/demo-backward` | — | Canned invalid sequence with a regression: `VEGETATIVE → GERMINATION` (legacy alias of `/demo/backward`) |
| `GET` | `/demo/<anything>` | — | Any unrecognized type falls through to the **healthy** full lifecycle — handy as the "valid" test case (`/demo/valid`) |
| `GET` | `/reset` | — | Clears the growth log and rewinds the predictor cursor to `SEED` |

### Example

```bash
curl -F "image=@leaf.jpg" -F "duration=2" http://127.0.0.1:5000/predict
```

Response: the rendered dashboard — the banner shows the predicted stage and the automaton's
verdict with per-rule messages.

---

## Project structure

```
PhytoState/
├── app.py               # Flask app: routes, in-memory session, glue
├── predictor.py         # Growth-stage predictor (pluggable interface)
├── automaton.py         # ★ The verification engine (pure Python, no deps)
├── requirements.txt     # Flask
├── templates/
│   └── index.html       # Single-page dashboard (Jinja2 server-rendered)
├── static/
│   ├── style.css        # Design system (Vercel/Geist-inspired monochrome)
│   └── app.js           # Progressive enhancement: fetch + hot-swap, previews
└── uploads/             # Uploaded crop photos land here
```

### The three brains

| Module | Role |
|---|---|
| `automaton.py` | `STAGES` order, `MIN_TIME` / `MAX_TIME` dwell tables, `verify_sequence(sequence, durations) → (valid, messages)`. Pure functions, fully deterministic. |
| `predictor.py` | `predict_stage(image_path) → stage`. Currently a **sequential demo model**: consecutive uploads walk `SEED → … → HARVEST` and wrap around. The interface is the seam for a real model — swap the body for a CNN inference call and nothing else changes. |
| `app.py` | HTTP layer only: routing, session state (`sequence`, `durations`), orchestration. No business logic. |

---

## Tech stack

- **Python 3** + **Flask** (SSR with Jinja2 templates)
- **Vanilla HTML / CSS / JS** — no frameworks, no bundler, no external assets
- Design system: monochrome Vercel/Geist-inspired dark theme; white primary accent; semantic
  colors only for verdicts (blue = verified, red = rejected, amber = stagnation)

---

## 60-second demo script

1. **Open** `http://127.0.0.1:5000` — empty state: *"No stages logged yet"*.
2. **Upload** a crop photo, set duration to `1`, hit **Analyze stage** →
   `SEED` predicted, banner goes red: *"Lifecycle has not reached HARVEST"* — the completeness
   rule doing its job.
3. **Keep uploading** (duration 2–3 each) — the timeline fills, the automaton diagram lights up
   state by state, the ledger shows every dwell inside its window.
4. **Reach `HARVEST`** — banner flips blue: *"Growth sequence verified."*
5. **Click "Run all 5"** in Verification Scenarios — the app replays all five rule violations
   live: skip, backward, premature, stagnation, then the healthy cycle. Each scenario card earns
   a "✓ run" badge.
6. **Reset** in the header — clean slate for the next run.

---

## Roadmap

- **Real classifier** — replace the sequential stub in `predictor.py` with a trained CNN
  (e.g. fine-tuned MobileNet on a growth-stage dataset). `predict_stage(image_path)` is the only
  seam to touch.
- **Species profiles** — per-crop `MIN_TIME` / `MAX_TIME` tables (tomato ≠ wheat), loaded from
  config.
- **Persistence** — SQLite or Postgres backing store, one session per field/plot instead of one
  global in-memory list.
- **Alerting** — webhook API when a sequence is rejected (the engine already returns structured
  reasons).
- **Field ingestion** — RPi + camera timelapse feeding `/predict` automatically.

## Known limitations (by design, for the hackathon)

- `predictor.py` is a placeholder that cycles stages — it does not inspect image pixels yet.
- State is in-memory and global: one shared session, cleared on server restart (or `/reset`).
- Flask dev server with `debug=True` — use a WSGI server (gunicorn/waitress) if you deploy it.
- Uploaded filenames are used as-is for the storage path — fine for a demo, sanitize before prod.
- `duration` must parse as an integer; the engine intentionally accepts `0` so premature
  transitions can be demonstrated.
