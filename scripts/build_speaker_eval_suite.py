#!/usr/bin/env python3
import argparse
from array import array
from dataclasses import dataclass
import json
from pathlib import Path
import sys
import wave


SAMPLE_RATE = 16000


@dataclass(frozen=True)
class Clip:
    speaker_id: str
    samples: array


@dataclass(frozen=True)
class Event:
    clip: Clip
    start_ms: int
    duration_ms: int


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--long-minutes", type=int, default=30)
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    clips = [load_clip(input_dir / f"speaker_{index}.wav", index) for index in range(1, 5)]
    cases = [
        build_two_person(clips[:2]),
        build_fast_switch(clips[:2]),
        build_overlap(clips[:2]),
        build_four_person(clips),
        build_long(clips, max(1, args.long_minutes) * 60_000),
    ]
    manifest = {"schemaVersion": 1, "sampleRate": SAMPLE_RATE, "cases": []}
    for case_id, events in cases:
        audio_path = output_dir / f"{case_id}.wav"
        duration_ms = render(audio_path, events)
        manifest["cases"].append({
            "id": case_id,
            "audio": audio_path.name,
            "durationMs": duration_ms,
            "reference": [
                {
                    "speakerId": event.clip.speaker_id,
                    "startMs": event.start_ms,
                    "endMs": event.start_ms + event.duration_ms,
                }
                for event in events
            ],
        })
    manifest_path = output_dir / "suite.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(manifest_path)


def load_clip(path: Path, speaker_index: int) -> Clip:
    with wave.open(str(path), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError(f"{path} must be mono pcm16")
        if audio.getframerate() != SAMPLE_RATE:
            raise ValueError(f"{path} must use {SAMPLE_RATE} Hz")
        samples = array("h", audio.readframes(audio.getnframes()))
    if sys.byteorder != "little":
        samples.byteswap()
    samples = trim_silence(samples)
    if len(samples) < SAMPLE_RATE * 3:
        raise ValueError(f"{path} must contain at least three seconds of speech")
    return Clip(speaker_id=f"speaker_{speaker_index}", samples=samples)


def trim_silence(samples: array) -> array:
    frame_size = SAMPLE_RATE // 50
    voiced = []
    for start in range(0, len(samples), frame_size):
        frame = samples[start:start + frame_size]
        if frame and sum(abs(value) for value in frame) / len(frame) >= 180:
            voiced.append(start)
    if not voiced:
        raise ValueError("source clip contains no detectable speech")
    padding = SAMPLE_RATE // 10
    first = max(0, voiced[0] - padding)
    last = min(len(samples), voiced[-1] + frame_size + padding)
    return samples[first:last]


def build_two_person(clips: list[Clip]):
    events = []
    cursor = 400
    for index in range(8):
        clip = clips[index % 2]
        duration = min(4200, duration_ms(clip.samples))
        events.append(Event(clip, cursor, duration))
        cursor += duration + 450
    return "two_person_turns", events


def build_fast_switch(clips: list[Clip]):
    events = []
    cursor = 300
    for index in range(20):
        events.append(Event(clips[index % 2], cursor, 1200))
        cursor += 1320
    return "fast_switch", events


def build_overlap(clips: list[Clip]):
    return "overlap", [
        Event(clips[0], 500, 5000),
        Event(clips[1], 2800, 5000),
        Event(clips[0], 8500, 4200),
        Event(clips[1], 10_300, 4800),
    ]


def build_four_person(clips: list[Clip]):
    events = []
    cursor = 300
    for index in range(12):
        events.append(Event(clips[index % 4], cursor, 3000))
        cursor += 3300
    return "four_person", events


def build_long(clips: list[Clip], target_ms: int):
    events = []
    cursor = 500
    index = 0
    while cursor + 4200 < target_ms:
        events.append(Event(clips[index % 4], cursor, 3800))
        cursor += 4200
        index += 1
    return "long_30m", events


def render(path: Path, events: list[Event]) -> int:
    end_ms = max(event.start_ms + event.duration_ms for event in events) + 300
    output = array("h", [0]) * (end_ms * SAMPLE_RATE // 1000)
    for event in events:
        start = event.start_ms * SAMPLE_RATE // 1000
        length = event.duration_ms * SAMPLE_RATE // 1000
        source = repeated(event.clip.samples, length)
        for offset, value in enumerate(source):
            mixed = output[start + offset] + value
            output[start + offset] = max(-32768, min(32767, mixed))
    encoded = array("h", output)
    if sys.byteorder != "little":
        encoded.byteswap()
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(SAMPLE_RATE)
        audio.writeframes(encoded.tobytes())
    return end_ms


def repeated(samples: array, length: int) -> array:
    result = array("h")
    while len(result) < length:
        result.extend(samples[:length - len(result)])
    return result


def duration_ms(samples: array) -> int:
    return len(samples) * 1000 // SAMPLE_RATE


if __name__ == "__main__":
    main()
