from flask import Flask, render_template, request

import predictor

from automaton import verify_sequence

app = Flask(__name__)

sequence = []
durations = []


@app.route("/")
def home():

    return render_template(
        "index.html",
        sequence=sequence,
        durations=durations
    )


@app.route("/predict", methods=["POST"])
def predict():

    image = request.files["image"]

    duration = int(request.form["duration"])

    image_path = "uploads/" + image.filename

    image.save(image_path)

    stage = predictor.predict_stage(image_path)

    sequence.append(stage)
    durations.append(duration)

    valid, messages = verify_sequence(
        sequence,
        durations
    )

    return render_template(
        "index.html",
        sequence=sequence,
        durations=durations,
        prediction=stage,
        valid=valid,
        messages=messages
    )


@app.route("/demo/<test_type>")
def demo(test_type):

    if test_type == "skip":

        demo_sequence = [
            "SEED",
            "FLOWERING",
            "FRUITING",
            "HARVEST"
        ]

        demo_durations = [1, 2, 3, 0]

    elif test_type == "backward":

        demo_sequence = [
            "SEED",
            "GERMINATION",
            "VEGETATIVE",
            "GERMINATION",
            "HARVEST"
        ]

        demo_durations = [1, 2, 3, 2, 0]

    elif test_type == "premature":

        demo_sequence = [
            "SEED",
            "GERMINATION",
            "VEGETATIVE",
            "FLOWERING",
            "FRUITING",
            "HARVEST"
        ]

        demo_durations = [1, 1, 3, 2, 3, 0]

    elif test_type == "stagnation":

        demo_sequence = [
            "SEED",
            "GERMINATION",
            "VEGETATIVE",
            "FLOWERING",
            "FRUITING",
            "HARVEST"
        ]

        demo_durations = [1, 2, 10, 2, 3, 0]

    else:

        demo_sequence = [
            "SEED",
            "GERMINATION",
            "VEGETATIVE",
            "FLOWERING",
            "FRUITING",
            "HARVEST"
        ]

        demo_durations = [1, 2, 3, 2, 3, 0]

    valid, messages = verify_sequence(
        demo_sequence,
        demo_durations
    )

    return render_template(
        "index.html",
        sequence=demo_sequence,
        durations=demo_durations,
        prediction=demo_sequence[-1],
        valid=valid,
        messages=messages
    )

@app.route("/demo-backward")
def demo_backward():

    demo_sequence = [
        "SEED",
        "GERMINATION",
        "VEGETATIVE",
        "GERMINATION",
        "HARVEST"
    ]

    demo_durations = [1, 2, 3, 2, 0]

    valid, messages = verify_sequence(
        demo_sequence,
        demo_durations
    )

    return render_template(
        "index.html",
        sequence=demo_sequence,
        durations=demo_durations,
        prediction="GERMINATION",
        valid=valid,
        messages=messages
    )

@app.route("/reset")
def reset():

    sequence.clear()
    durations.clear()

    predictor.current_index = 0

    return render_template(
        "index.html",
        sequence=[],
        durations=[]
    )


if __name__ == "__main__":
    app.run(debug=True)