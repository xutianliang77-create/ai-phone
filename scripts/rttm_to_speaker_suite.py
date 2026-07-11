#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import wave


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--rttm", required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    audio_path = Path(args.audio)
    duration_ms, sample_rate = audio_metadata(audio_path)
    references = parse_rttm(Path(args.rttm), args.case_id, duration_ms)
    if not references:
        raise ValueError(f"RTTM contains no SPEAKER rows for {args.case_id}")
    payload = {
        "schemaVersion": 2,
        "sampleRate": sample_rate,
        "cases": [{
            "id": args.case_id,
            "audio": audio_path.name,
            "durationMs": duration_ms,
            "purpose": "quality",
            "reference": references,
        }],
    }
    Path(args.output).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    )
    print(json.dumps({
        "caseId": args.case_id,
        "durationMs": duration_ms,
        "sampleRate": sample_rate,
        "referenceSpans": len(references),
        "speakers": sorted({item["speakerId"] for item in references}),
    }, ensure_ascii=False))


def audio_metadata(path: Path) -> tuple[int, int]:
    with wave.open(str(path), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError("audio must be mono PCM16 WAV")
        sample_rate = audio.getframerate()
        if sample_rate not in (16000, 24000):
            raise ValueError("audio sample rate must be 16000 or 24000 Hz")
        duration_ms = audio.getnframes() * 1000 // sample_rate
    return duration_ms, sample_rate


def parse_rttm(path: Path, recording_id: str, duration_ms: int):
    spans = []
    for line_number, raw in enumerate(path.read_text().splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) != 10 or fields[0] != "SPEAKER":
            raise ValueError(f"invalid RTTM row at line {line_number}")
        if fields[1] != recording_id:
            continue
        start_ms = round(float(fields[3]) * 1000)
        duration = round(float(fields[4]) * 1000)
        end_ms = start_ms + duration
        if start_ms < 0 or duration <= 0 or end_ms > duration_ms:
            raise ValueError(f"RTTM timing is outside audio at line {line_number}")
        spans.append({
            "speakerId": fields[7],
            "startMs": start_ms,
            "endMs": end_ms,
        })
    return sorted(spans, key=lambda item: (item["startMs"], item["speakerId"]))


if __name__ == "__main__":
    main()
