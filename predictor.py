"""Growth-stage predictor for PhytoState.

One interface, two interchangeable backends:

- neural       zero-shot CLIP vision-language model (optional dependency).
               No training data is required: a crop profile describes every
               growth stage in plain language ("a tomato plant with small
               yellow flowers") and CLIP scores the photo against each
               description. Adding a new crop means editing a JSON file,
               never training a model.

- simulation   sequential demo stub that walks the lifecycle in order.
               Always available, fully offline, zero dependencies. Used as
               an automatic fallback so the demo can never break.

predict_stage() always returns a dict:
    {"stage": str | None, "confidence": float | None, "mode": str}
`stage` is None when the neural model judges the photo to be no crop at
all (the profile's reject prompts won).
"""

import functools
import importlib.util
import threading

# Fallback vocabulary, kept for backward compatibility. The active profile
# (loaded from profiles/*.json) drives the real vocabulary at runtime.
STAGES = [
    "SEED",
    "GERMINATION",
    "VEGETATIVE",
    "FLOWERING",
    "FRUITING",
    "HARVEST"
]

# Generic non-crop prompts the neural backend competes stages against.
REJECT_PROMPTS = [
    "a random household object",
    "a person taking a selfie",
    "a vehicle on a road",
    "a building or an empty room",
    "a plate of cooked food",
    "a computer screen with code",
]

MODEL_ID = "openai/clip-vit-base-patch32"

current_index = 0

_mode = "simulation"
_warmup_started = False


def get_mode():

    return _mode


def reset():

    global current_index
    current_index = 0


def _ml_available():

    return (
        importlib.util.find_spec("torch") is not None
        and importlib.util.find_spec("transformers") is not None
    )


@functools.lru_cache(maxsize=1)
def _load_model():

    from transformers import CLIPModel, CLIPProcessor

    model = CLIPModel.from_pretrained(MODEL_ID)
    processor = CLIPProcessor.from_pretrained(MODEL_ID)
    model.eval()

    return model, processor


def start_background_warmup():

    """Preload CLIP weights once at startup so the first /predict is fast.

    A single one-shot daemon thread — no polling, no loops: it loads the
    model and exits. If anything fails, we stay in simulation mode.
    """

    global _warmup_started

    if _warmup_started or not _ml_available():
        return

    _warmup_started = True

    def _warmup():
        global _mode
        try:
            _load_model()
            _mode = "neural"
        except Exception:
            _mode = "simulation"

    threading.Thread(target=_warmup, daemon=True).start()


def predict_stage(image_path, stages=None, prompts=None, rejects=None):

    global current_index

    stages = list(stages or STAGES)
    prompts = prompts or {}

    has_prompts = any(prompts.get(s) for s in stages)

    if _mode == "neural" and has_prompts:
        try:
            return _predict_neural(
                image_path,
                stages,
                prompts,
                list(rejects or []) + REJECT_PROMPTS
            )
        except Exception:
            # Neural inference failed for any reason — fall through to the
            # simulation backend so the demo never dies.
            pass

    stage = stages[current_index % len(stages)]
    current_index = (current_index + 1) % len(stages)

    return {
        "stage": stage,
        "confidence": None,
        "mode": "simulation"
    }


def _predict_neural(image_path, stages, prompts, rejects):

    import torch
    from PIL import Image

    model, processor = _load_model()

    image = Image.open(image_path).convert("RGB")

    texts = []
    owner = []

    for stage in stages:
        for prompt in prompts.get(stage, []):
            texts.append(prompt)
            owner.append(stage)

    for prompt in rejects:
        texts.append(prompt)
        owner.append(None)

    inputs = processor(
        text=texts,
        images=image,
        return_tensors="pt",
        padding=True,
        truncation=True
    )

    with torch.no_grad():
        output = model(**inputs)

    sims = output.logits_per_image[0].tolist()

    # Class-level score: best-matching prompt per stage, then a single
    # softmax across stages + rejects (CLIP's logits are already scaled).
    class_scores = []
    for stage in stages:
        idxs = [i for i, o in enumerate(owner) if o == stage]
        class_scores.append(max(sims[i] for i in idxs))

    reject_idxs = [i for i, o in enumerate(owner) if o is None]
    reject_score = max(sims[i] for i in reject_idxs) if reject_idxs else -1e9

    probs = torch.tensor(class_scores + [reject_score]).softmax(dim=0).tolist()

    best_index = max(range(len(stages)), key=lambda i: class_scores[i])
    best_guess = stages[best_index]

    if reject_score > class_scores[best_index]:
        return {
            "stage": None,
            "confidence": round(probs[best_index], 4),
            "best_guess": best_guess,
            "mode": "neural"
        }

    return {
        "stage": best_guess,
        "confidence": round(probs[best_index], 4),
        "best_guess": best_guess,
        "mode": "neural"
    }
