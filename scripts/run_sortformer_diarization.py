#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import time
import wave


PROFILES = {
    "low-latency": {
        "chunk_len": 6,
        "chunk_left_context": 1,
        "chunk_right_context": 7,
        "fifo_len": 188,
        "spkcache_update_period": 144,
        "spkcache_len": 188,
    },
    "high-accuracy": {
        "chunk_len": 340,
        "chunk_left_context": 1,
        "chunk_right_context": 40,
        "fifo_len": 40,
        "spkcache_update_period": 300,
        "spkcache_len": 188,
    },
}


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--audio")
    group.add_argument("--suite")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--model",
        default="nvidia/diar_streaming_sortformer_4spk-v2.1",
    )
    parser.add_argument(
        "--profile",
        choices=sorted(PROFILES),
        default="low-latency",
    )
    parser.add_argument("--postprocessing-yaml")
    parser.add_argument("--include-probabilities", action="store_true")
    args = parser.parse_args()

    from nemo.collections.asr.models import SortformerEncLabelModel

    model = (
        SortformerEncLabelModel.restore_from(
            restore_path=args.model,
            map_location="cuda",
            strict=False,
        )
        if Path(args.model).is_file()
        else SortformerEncLabelModel.from_pretrained(args.model)
    )
    model.eval()
    profile = PROFILES[args.profile]
    modules = model.sortformer_modules
    modules.chunk_len = profile["chunk_len"]
    modules.chunk_left_context = profile["chunk_left_context"]
    modules.chunk_right_context = profile["chunk_right_context"]
    modules.fifo_len = profile["fifo_len"]
    modules.spkcache_update_period = profile["spkcache_update_period"]
    modules.spkcache_len = profile["spkcache_len"]
    modules._check_streaming_parameters()
    payload = (
        run_suite(
            model,
            args.suite,
            args.model,
            args.profile,
            profile,
            args.postprocessing_yaml,
            args.include_probabilities,
        )
        if args.suite
        else run_one(
            model,
            args.audio,
            args.model,
            args.profile,
            profile,
            args.postprocessing_yaml,
            args.include_probabilities,
        )
    )
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False, indent=2)
        output.write("\n")


def run_suite(
    model,
    suite_path: str,
    model_id: str,
    profile_name: str,
    profile: dict[str, int],
    postprocessing_yaml: str | None,
    include_probabilities: bool,
) -> dict[str, object]:
    with open(suite_path, encoding="utf-8") as source:
        suite = json.load(source)
    suite_dir = Path(suite_path).resolve().parent
    cases = []
    for case in suite["cases"]:
        audio_path = Path(case["audio"])
        if not audio_path.is_absolute():
            audio_path = suite_dir / audio_path
        result = run_one(
            model,
            str(audio_path),
            model_id,
            profile_name,
            profile,
            postprocessing_yaml,
            include_probabilities,
        )
        cases.append({
            **case,
            **result,
            "audio": str(audio_path),
        })
    return {
        "schemaVersion": 1,
        "model": model_id,
        "profile": profile_name,
        "streamingParameters": profile,
        "postprocessingYaml": postprocessing_yaml,
        "cases": cases,
    }


def run_one(
    model,
    audio_path: str,
    model_id: str,
    profile_name: str,
    profile: dict[str, int],
    postprocessing_yaml: str | None,
    include_probabilities: bool,
) -> dict[str, object]:
    started_at = time.monotonic()
    diarize_result = model.diarize(
        audio=[audio_path],
        batch_size=1,
        include_tensor_outputs=include_probabilities,
        postprocessing_yaml=postprocessing_yaml,
    )
    inference_ms = round((time.monotonic() - started_at) * 1000)
    duration_ms = wav_duration_ms(audio_path)
    if include_probabilities:
        predicted, probability_tensors = diarize_result
        tensor = probability_tensors[0].detach().cpu()
        if tensor.ndim == 3 and tensor.shape[0] == 1:
            tensor = tensor.squeeze(0)
        probabilities = tensor.tolist()
    else:
        predicted = diarize_result
        probabilities = None
    payload = {
        "audio": audio_path,
        "model": model_id,
        "profile": profile_name,
        "streamingParameters": profile,
        "postprocessingYaml": postprocessing_yaml,
        "durationMs": duration_ms,
        "inferenceMs": inference_ms,
        "realTimeFactor": round(inference_ms / duration_ms, 6),
        "predicted": [parse_segment(item) for item in predicted[0]],
    }
    if probabilities is not None:
        payload["probabilities"] = probabilities
    return payload


def parse_segment(value: object) -> dict[str, object]:
    if isinstance(value, str):
        fields = value.replace(",", " ").split()
    else:
        fields = list(value)  # type: ignore[arg-type]
    if len(fields) < 3:
        raise ValueError(f"Unsupported Sortformer segment: {value!r}")
    return {
        "startMs": round(float(fields[0]) * 1000),
        "endMs": round(float(fields[1]) * 1000),
        "speakerId": normalize_speaker(fields[2]),
    }


def normalize_speaker(value: object) -> str:
    label = str(value)
    digits = "".join(character for character in label if character.isdigit())
    return f"speaker_{int(digits) + 1}" if digits else label


def wav_duration_ms(path: str) -> int:
    with wave.open(path, "rb") as audio:
        return round(audio.getnframes() * 1000 / audio.getframerate())


if __name__ == "__main__":
    main()
