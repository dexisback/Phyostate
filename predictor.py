STAGES = [
    "SEED",
    "GERMINATION",
    "VEGETATIVE",
    "FLOWERING",
    "FRUITING",
    "HARVEST"
]

current_index = 0


def predict_stage(image_path):

    global current_index

    stage = STAGES[current_index]

    current_index += 1

    if current_index >= len(STAGES):
        current_index = 0

    return stage