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
- **🧠 Neural stage classifier** — zero-shot CLIP scores each photo against every stage's
  plain-language description (no training data involved). The UI shows a confidence % per
  observation, and photos that aren't the active crop get rejected with a reason. Falls back
  automatically to simulation mode when ML extras aren't installed.
- **🌾 Species profiles** — tomato, lettuce and wheat each ship their own stage vocabulary and
  dwell windows; a header dropdown switches crop. New profiles are just JSON files — drop one
  into `profiles/` and it appears in the dropdown.
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
- **🧯 Hardened intake** — upload size caps, image-type checks, safe UUID storage names, and
  graceful JSON error responses instead of stack traces.

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

<details>
<summary><b>Optional: neural classifier (CLIP)</b></summary>

The predictor runs in **simulation mode** by default (works offline, zero heavy deps). To enable
the real zero-shot CLIP vision backend:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install transformers pillow

# Cache the model weights once (afterwards it runs fully offline):
python3 -c "from transformers import CLIPModel, CLIPProcessor; \
    CLIPModel.from_pretrained('openai/clip-vit-base-patch32'); \
    CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')"
```

The server preloads the weights on startup; if anything is missing it silently falls back to
simulation mode (see the mode chip in the UI).

</details>

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
| `GET` | `/reset` | — | Clears the growth log and rewinds the predictor cursor to the first stage |
| `POST` | `/profile` | `form`: `id` (profile id) | Switches the active crop profile; clears the lifecycle and rewinds the cursor |
| `GET` | `/export?format=json\|md` | — | Downloads a verification report (observations, allowed windows, verdict, engine messages) |
| `GET` | `/health` | — | JSON status: active profile, stages logged, predictor mode, engine version |

Invalid input returns a clean JSON error (`{"error": "..."}`) with the proper status code —
never a stack trace.

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
├── app.py               # Flask app: routes, in-memory session, intake hardening
├── predictor.py         # Growth-stage predictor: CLIP neural backend + simulation fallback
├── automaton.py         # ★ The verification engine (pure Python, no deps)
├── requirements.txt     # Flask
├── profiles/            # Species profiles: stages, dwell bounds, CLIP prompts, demo cases
│   ├── tomato.json
│   ├── lettuce.json
│   └── wheat.json
├── templates/
│   └── index.html       # Single-page dashboard (Jinja2 server-rendered)
├── static/
│   ├── style.css        # Design system (Vercel/Geist-inspired monochrome)
│   └── app.js           # Progressive enhancement: fetch + hot-swap, Gantt, sim
└── uploads/             # Uploaded crop photos land here (UUID-prefixed names)
```

### The three brains

| Module | Role |
|---|---|
| `automaton.py` | `verify_sequence(sequence, durations, stages, min_time, max_time) → (valid, messages)`. Rule tables are parameters — profiles plug in. Pure functions, fully deterministic. |
| `predictor.py` | `predict_stage(image_path, stages, prompts) → {stage, confidence, mode}`. **Neural backend:** zero-shot CLIP — the profile's text prompts *are* the training data. **Simulation backend:** sequential stub cycling the profile's stages. Automatic fallback between them. |
| `app.py` | HTTP layer: routing, session state, intake validation, export. No business logic. |

---

## Tech stack

- **Python 3** + **Flask** (SSR with Jinja2 templates)
- **Optional ML extras**: torch (CPU) + transformers for the zero-shot CLIP backend
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
6. **Switch the Crop dropdown to Wheat** — the automaton becomes 7 field stages with long
   dwell windows; run a scenario again to show the same engine verifying different biology.
7. **Reset** in the header — clean slate for the next run.

---

## Roadmap

- **Species packs** — more crops (maize, rice, soybean) are pure JSON additions to `profiles/`.
- **Persistence** — SQLite or Postgres backing store, one session per field/plot instead of one
  global in-memory list.
- **Alerting** — webhook API when a sequence is rejected (the engine already returns structured
  reasons).
- **Field ingestion** — RPi + camera timelapse feeding `/predict` automatically.

## Known limitations (by design, for the hackathon)

- Without the optional ML extras, the predictor runs in **simulation mode** (sequential stub) —
  the UI shows which backend is active. The verification engine is fully real either way.
- State is in-memory and global: one shared session, cleared on server restart (or `/reset`);
  `/export` produces a durable report of the current session.
- Flask's built-in server (no WSGI tuning) — fine for a demo; use gunicorn/waitress to deploy.
- Uploaded files accumulate in `uploads/` (UUID-prefixed, no auto-cleanup).
