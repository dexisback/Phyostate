STAGES = [
    "SEED",
    "GERMINATION",
    "VEGETATIVE",
    "FLOWERING",
    "FRUITING",
    "HARVEST"
]


MIN_TIME = {
    "SEED": 1,
    "GERMINATION": 2,
    "VEGETATIVE": 3,
    "FLOWERING": 2,
    "FRUITING": 3,
    "HARVEST": 0
}


MAX_TIME = {
    "SEED": 3,
    "GERMINATION": 5,
    "VEGETATIVE": 8,
    "FLOWERING": 5,
    "FRUITING": 7,
    "HARVEST": 0
}


def verify_sequence(sequence, durations, stages=None, min_time=None, max_time=None):

    stages = stages or STAGES
    min_time = min_time or MIN_TIME
    max_time = max_time or MAX_TIME

    errors = []

    if len(sequence) == 0:
        return False, [
            "No stage prediction available."
        ]


    # Check stage transitions
    for i in range(len(sequence) - 1):

        current = sequence[i]
        next_stage = sequence[i + 1]

        current_index = stages.index(current)
        next_index = stages.index(next_stage)


        # Backward transition
        if next_index < current_index:

            errors.append(
                f"Backward transition detected: "
                f"{current} → {next_stage}"
            )


        # Stage skipping
        elif next_index > current_index + 1:

            errors.append(
                f"Stage skipping detected: "
                f"{current} → {next_stage}"
            )


    # Check dwell time
    for i in range(len(sequence)):

        stage = sequence[i]
        duration = durations[i]

        minimum = min_time[stage]
        maximum = max_time[stage]


        # Premature stage
        if duration < minimum:

            errors.append(
                f"Premature transition: "
                f"{stage} duration is {duration} day(s). "
                f"Minimum required is {minimum} day(s)."
            )


        # Excessive dwell time
        elif duration > maximum and stage != "HARVEST":

            errors.append(
                f"Abnormal stagnation: "
                f"{stage} lasted {duration} day(s). "
                f"Maximum allowed is {maximum} day(s)."
            )


    # Harvest check
    if sequence[-1] != "HARVEST":

        errors.append(
            "Lifecycle has not reached HARVEST."
        )


    # Final result
    if errors:

        return False, errors


    return True, [
        "Sequence and dwell-time constraints "
        "accepted by the PhytoState automaton."
    ]