#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import wave


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
    modules = model.sortformer_modules
    modules.chunk_len = 340
    modules.chunk_right_context = 40
    modules.fifo_len = 40
    modules.spkcache_update_period = 300
    modules._check_streaming_parameters()
    payload = run_suite(model, args.suite, args.model) if args.suite else (
        run_one(model, args.audio, args.model)
    )
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False, indent=2)
        output.write("\n")


def run_suite(model, suite_path: str, model_id: str) -> dict[str, object]:
    with open(suite_path, encoding="utf-8") as source:
        suite = json.load(source)
    suite_dir = Path(suite_path).resolve().parent
    cases = []
    for case in suite["cases"]:
        audio_path = Path(case["audio"])
        if not audio_path.is_absolute():
            audio_path = suite_dir / audio_path
        result = run_one(model, str(audio_path), model_id)
        cases.append({
            **case,
            "audio": str(audio_path),
            "predicted": result["predicted"],
        })
    return {"schemaVersion": 1, "model": model_id, "cases": cases}


def run_one(model, audio_path: str, model_id: str) -> dict[str, object]:
    predicted = model.diarize(audio=[audio_path], batch_size=1)
    return {
        "audio": audio_path,
        "model": model_id,
        "durationMs": wav_duration_ms(audio_path),
        "predicted": [parse_segment(item) for item in predicted[0]],
    }


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
