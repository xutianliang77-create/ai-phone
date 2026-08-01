#!/usr/bin/env python3
import argparse
from array import array
import json
from pathlib import Path
import re
import wave


TIER_PATTERN = re.compile(r'^\s*name = "([^"]+)"\s*$')
XMIN_PATTERN = re.compile(r"^\s*xmin = ([0-9.]+)\s*$")
XMAX_PATTERN = re.compile(r"^\s*xmax = ([0-9.]+)\s*$")
TEXT_PATTERN = re.compile(r'^\s*text = "(.*)"\s*$')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--textgrid", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--case-id", default="alimeeting_far_90s")
    parser.add_argument("--channel", type=int, default=0)
    parser.add_argument("--start-sec", type=float, default=0.0)
    parser.add_argument("--duration-sec", type=float, default=90.0)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    audio_output = output_dir / f"{args.case_id}.wav"
    suite_output = output_dir / "suite.json"
    extract_channel(
        Path(args.audio),
        audio_output,
        args.channel,
        args.start_sec,
        args.duration_sec,
    )
    references = crop_references(
        parse_textgrid(Path(args.textgrid)),
        args.start_sec,
        args.duration_sec,
    )
    payload = {
        "schemaVersion": 1,
        "sampleRate": 16000,
        "source": {
            "audio": str(Path(args.audio).resolve()),
            "textgrid": str(Path(args.textgrid).resolve()),
            "channel": args.channel,
            "startSec": args.start_sec,
            "durationSec": args.duration_sec,
        },
        "cases": [{
            "id": args.case_id,
            "audio": audio_output.name,
            "durationMs": round(args.duration_sec * 1000),
            "reference": references,
        }],
    }
    suite_output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "suite": str(suite_output),
        "audio": str(audio_output),
        "referenceSpans": len(references),
        "speakers": sorted({item["speakerId"] for item in references}),
    }, ensure_ascii=False))


def parse_textgrid(path: Path) -> list[dict[str, object]]:
    current_tier: str | None = None
    interval: dict[str, object] = {}
    references: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if match := TIER_PATTERN.match(line):
            current_tier = match.group(1)
            interval = {}
            continue
        if current_tier is None:
            continue
        if match := XMIN_PATTERN.match(line):
            interval["startSec"] = float(match.group(1))
            continue
        if match := XMAX_PATTERN.match(line):
            interval["endSec"] = float(match.group(1))
            continue
        if match := TEXT_PATTERN.match(line):
            text = match.group(1).strip()
            if text and {"startSec", "endSec"} <= interval.keys():
                references.append({
                    "speakerId": current_tier.removeprefix("N_"),
                    "startSec": interval["startSec"],
                    "endSec": interval["endSec"],
                })
            interval = {}
    return references


def crop_references(
    references: list[dict[str, object]],
    start_sec: float,
    duration_sec: float,
) -> list[dict[str, object]]:
    end_sec = start_sec + duration_sec
    cropped = []
    for item in references:
        start = max(float(item["startSec"]), start_sec)
        end = min(float(item["endSec"]), end_sec)
        if end <= start:
            continue
        cropped.append({
            "speakerId": item["speakerId"],
            "startMs": round((start - start_sec) * 1000),
            "endMs": round((end - start_sec) * 1000),
        })
    return sorted(cropped, key=lambda item: (item["startMs"], item["endMs"]))


def extract_channel(
    source: Path,
    destination: Path,
    channel: int,
    start_sec: float,
    duration_sec: float,
) -> None:
    with wave.open(str(source), "rb") as input_audio:
        channels = input_audio.getnchannels()
        sample_rate = input_audio.getframerate()
        if input_audio.getsampwidth() != 2:
            raise ValueError("source audio must use PCM16 samples")
        if sample_rate != 16000:
            raise ValueError("source audio must be sampled at 16 kHz")
        if not 0 <= channel < channels:
            raise ValueError(f"channel must be in [0, {channels - 1}]")
        input_audio.setpos(round(start_sec * sample_rate))
        raw = input_audio.readframes(round(duration_sec * sample_rate))
    samples = array("h")
    samples.frombytes(raw)
    mono = array("h", samples[channel::channels])
    with wave.open(str(destination), "wb") as output_audio:
        output_audio.setnchannels(1)
        output_audio.setsampwidth(2)
        output_audio.setframerate(sample_rate)
        output_audio.writeframes(mono.tobytes())


if __name__ == "__main__":
    main()
