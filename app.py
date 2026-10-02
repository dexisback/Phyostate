import functools
import json
import os
import uuid
from datetime import datetime, timezone

from flask import Flask, Response, jsonify, render_template, request
from werkzeug.utils import secure_filename

import predictor
from automaton import verify_sequence

app = Flask(__name__)

# Hardening: cap upload size; keep templates live without exposing the
# interactive Werkzeug debugger (debug=False -> no /console RCE surface).
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB
app.config["TEMPLATES_AUTO_RELOAD"] = True

# Active crop profile + discovered profiles (drop a JSON into profiles/
# and it appears in the header dropdown — no code changes).
app.config["PROFILE"] = "tomato"

UPLOAD_DIR = "uploads"
PROFILE_DIR = "profiles"

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}

os.makedirs(UPLOAD_DIR, exist_ok=True)

sequence = []
durations = []


# --------------------------------------------------------------------- #
# Crop profiles (profiles/*.json drive stages, dwell bounds, prompts)   #
# --------------------------------------------------------------------- #

@functools.lru_cache(maxsize=None)
def _load_profile(profile_id):

    path = os.path.join(PROFILE_DIR, f"{profile_id}.json")

    if not os.path.isfile(path):
        return None

    with open(path) as f:
        profile = json.load(f)

    icons = profile.get("icons", {})
    profile["icons"] = {s: icons.get(s, "stage") for s in profile["stages"]}
    profile.setdefault("rejects", [])
    profile.setdefault("prompts", {})

    return profile


def _profile_list():

    found = []

    if os.path.isdir(PROFILE_DIR):
        for filename in sorted(os.listdir(PROFILE_DIR)):
            if filename.endswith(".json"):
                profile = _load_profile(filename[:-5])
                if profile:
                    found.append({"id": profile["id"], "name": profile["name"]})

    return found


def get_profile():

    profile = _load_profile(app.config["PROFILE"])

    if profile is None:  # defensive: config points at a missing file
        app.config["PROFILE"] = "tomato"
        profile = _load_profile("tomato")

    return profile


def _profile_bounds(profile):

    return {
        stage: [profile["min_days"][stage], profile["max_days"][stage]]
        for stage in profile["stages"]
    }


def render(**extra):

    profile = get_profile()

    context = dict(
        sequence=sequence,
        durations=durations,
        profile=profile,
        profiles=_profile_list(),
        bounds=_profile_bounds(profile),
        icons=profile["icons"],
        predictor_mode=predictor.get_mode(),
    )
    context.update(extra)

    return render_template("index.html", **context)


def _json_error(status, message):

    response = jsonify(error=message)
    response.status_code = status
    return response


@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(413)
@app.errorhandler(500)
def _http_error(error):

    code = getattr(error, "code", 500)
    message = {
        400: "Bad request.",
        404: "Not found.",
        413: "Upload too large (16 MB max).",
        500: "Internal server error.",
    }.get(code, str(error))

    return _json_error(code, message)


# --------------------------------------------------------------------- #
# Routes                                                                #
# --------------------------------------------------------------------- #

@app.route("/")
def home():

    return render()


def _allowed_image(filename, mimetype):

    extension = os.path.splitext(filename or "")[1].lower()
    return extension in ALLOWED_EXTENSIONS and (mimetype or "").startswith("image/")


@app.route("/predict", methods=["POST"])
def predict():

    image = request.files.get("image")

    if image is None or not image.filename:
        return _json_error(400, "No image file was provided.")

    if not _allowed_image(image.filename, image.mimetype):
        return _json_error(400, "Unsupported image type — use PNG, JPG or WebP.")

    try:
        duration = int(request.form.get("duration", ""))
    except (TypeError, ValueError):
        return _json_error(400, "Duration must be an integer number of days.")

    if duration < 0:
        return _json_error(400, "Duration cannot be negative.")

    profile = get_profile()

    # Hardened storage path: never trust the client filename directly.
    safe_name = secure_filename(image.filename) or "upload.png"
    image_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex[:12]}_{safe_name}")
    image.save(image_path)

    result = predictor.predict_stage(
        image_path,
        stages=profile["stages"],
        prompts=profile["prompts"],
        rejects=profile["rejects"],
    )

    if result["stage"] is None:
        os.remove(image_path)

        confidence = round((result.get("confidence") or 0) * 100)
        guess = result.get("best_guess", "unknown")

        return render(
            valid=False,
            banner_headline="Observation rejected",
            messages=[
                "The photo does not look like a "
                f"{profile['name']} at any growth stage "
                f"(best guess: {guess}, {confidence}% confidence)."
            ],
        )

    sequence.append(result["stage"])
    durations.append(duration)

    valid, messages = verify_sequence(
        sequence,
        durations,
        stages=profile["stages"],
        min_time=profile["min_days"],
        max_time=profile["max_days"],
    )

    return render(prediction=result, valid=valid, messages=messages)


def _demo_response(test_type):

    profile = get_profile()

    # Known scenario names replay their canned lifecycle; anything else
    # falls through to the healthy case (original else-branch behavior).
    demo = profile["demos"].get(test_type) or profile["demos"]["valid"]

    valid, messages = verify_sequence(
        demo["sequence"],
        demo["durations"],
        stages=profile["stages"],
        min_time=profile["min_days"],
        max_time=profile["max_days"],
    )

    return render(
        sequence=demo["sequence"],
        durations=demo["durations"],
        prediction={
            "stage": demo["sequence"][-1],
            "confidence": None,
            "mode": "scenario",
        },
        valid=valid,
        messages=messages,
    )


@app.route("/demo/<test_type>")
def demo(test_type):

    return _demo_response(test_type)


@app.route("/demo-backward")
def demo_backward():

    return _demo_response("backward")


@app.route("/profile", methods=["POST"])
def switch_profile():

    profile_id = request.form.get("id")

    profile = _load_profile(profile_id)

    if profile is None:
        return _json_error(400, f"Unknown crop profile: {profile_id}")

    app.config["PROFILE"] = profile_id

    # A new crop is a new lifecycle: clear observations, rewind the cursor.
    sequence.clear()
    durations.clear()
    predictor.reset()

    return render(
        valid=True,
        banner_headline=f"Crop profile: {profile['name']}",
        messages=[
            f"Now verifying against the {profile['name']} profile — "
            f"{len(profile['stages'])} stages. Lifecycle reset."
        ],
    )


@app.route("/reset")
def reset():

    sequence.clear()
    durations.clear()
    predictor.reset()

    return render(
        valid=True,
        banner_headline="Session reset",
        messages=["Lifecycle cleared and model cursor rewound to the first stage."],
    )


@app.route("/health")
def health():

    profile = get_profile()

    return jsonify(
        status="ok",
        profile=profile["id"],
        stages_logged=len(sequence),
        predictor_mode=predictor.get_mode(),
        engine="timed-automaton/1.0",
    )


@app.route("/export")
def export():

    profile = get_profile()

    if sequence:
        valid, messages = verify_sequence(
            list(sequence),
            list(durations),
            stages=profile["stages"],
            min_time=profile["min_days"],
            max_time=profile["max_days"],
        )
    else:
        valid, messages = False, ["No observations logged."]

    generated_at = datetime.now(timezone.utc).isoformat()

    observations = []
    cumulative = 0
    for i, stage in enumerate(sequence):
        observations.append({
            "index": i,
            "stage": stage,
            "days": durations[i],
            "start_day": cumulative,
            "allowed": _profile_bounds(profile)[stage],
        })
        cumulative += durations[i]

    if request.args.get("format") == "md":

        lines = [
            f"# PhytoState verification report",
            "",
            f"- **Crop profile:** {profile['name']}",
            f"- **Generated:** {generated_at}",
            f"- **Verdict:** {'VERIFIED' if valid else 'REJECTED'}",
            "",
            "| # | Stage | Days | Allowed window |",
            "|---|-------|------|----------------|",
        ]
        for obs in observations:
            lo, hi = obs["allowed"]
            window = "—" if stage_is_terminal(profile, obs["stage"]) else f"{lo}–{hi} d"
            lines.append(f"| {obs['index'] + 1} | {obs['stage']} | {obs['days']} d | {window} |")
        lines += ["", "## Engine messages", ""]
        lines += [f"- {m}" for m in messages]

        body = "\n".join(lines) + "\n"
        return Response(
            body,
            mimetype="text/markdown",
            headers={"Content-Disposition": f"attachment; filename=phytostate-report-{profile['id']}.md"},
        )

    payload = {
        "generated_at": generated_at,
        "profile": {"id": profile["id"], "name": profile["name"]},
        "predictor_mode": predictor.get_mode(),
        "observations": observations,
        "verdict": {"valid": valid, "messages": messages},
    }

    return Response(
        json.dumps(payload, indent=2) + "\n",
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename=phytostate-report-{profile['id']}.json"},
    )


def stage_is_terminal(profile, stage):

    return stage == profile["stages"][-1]


if __name__ == "__main__":
    predictor.start_background_warmup()
    app.run(debug=False)
