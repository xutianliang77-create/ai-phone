#!/usr/bin/env python3
import argparse
import json
import wave


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--model",
        default="nvidia/diar_streaming_sortformer_4spk-v2.1",
    )
    args = parser.parse_args()

    from nemo.collections.asr.models import SortformerEncLabelModel

    model = SortformerEncLabelModel.from_pretrained(args.model)
    model.eval()
    modules = model.sortformer_modules
    modules.chunk_len = 340
    modules.chunk_right_context = 40
    modules.fifo_len = 40
    modules.spkcache_update_period = 300
    modules._check_streaming_parameters()
    predicted = model.diarize(audio=[args.audio], batch_size=1)
    payload = {
        "audio": args.audio,
        "model": args.model,
        "durationMs": wav_duration_ms(args.audio),
        "predicted": [parse_segment(item) for item in predicted[0]],
    }
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False, indent=2)
        output.write("\n")


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
