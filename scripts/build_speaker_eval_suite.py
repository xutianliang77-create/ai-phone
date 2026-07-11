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
    clips = [load_clips(input_dir, index) for index in range(1, 5)]
    require_clip_count(clips)
    cases = [
        build_two_person(clips[:2]),
        build_fast_switch(clips[:2]),
        build_overlap(clips[:2]),
        build_four_person(clips),
        build_long(clips, max(1, args.long_minutes) * 60_000),
    ]
    manifest = {"schemaVersion": 2, "sampleRate": SAMPLE_RATE, "cases": []}
    for case_id, events in cases:
        audio_path = output_dir / f"{case_id}.wav"
        duration_ms = render(audio_path, events)
        manifest["cases"].append({
            "id": case_id,
            "audio": audio_path.name,
            "durationMs": duration_ms,
            "purpose": "stability_only" if case_id == "long_30m" else "quality",
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


def load_clips(input_dir: Path, speaker_index: int) -> list[Clip]:
    paths = sorted(input_dir.glob(f"speaker_{speaker_index}_*.wav"))
    paths.extend(sorted((input_dir / f"speaker_{speaker_index}").glob("*.wav")))
    if not paths:
        raise ValueError(
            f"speaker_{speaker_index} requires multiple unique wav files; "
            f"use speaker_{speaker_index}_01.wav or speaker_{speaker_index}/*.wav",
        )
    return [load_clip(path, speaker_index) for path in paths]


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
    if len(samples) < SAMPLE_RATE:
        raise ValueError(f"{path} must contain at least one second of speech")
    return Clip(speaker_id=f"speaker_{speaker_index}", samples=samples)


def require_clip_count(clips: list[list[Clip]]) -> None:
    minimums = [10, 10, 3, 3]
    for index, (speaker_clips, minimum) in enumerate(zip(clips, minimums), start=1):
        if len(speaker_clips) < minimum:
            raise ValueError(
                f"speaker_{index} requires at least {minimum} unique clips; "
                f"found {len(speaker_clips)}",
            )


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


def build_two_person(clips: list[list[Clip]]):
    events = []
    cursor = 400
    for index in range(8):
        speaker = index % 2
        clip = clips[speaker][index // 2]
        duration = min(4200, duration_ms(clip.samples))
        events.append(Event(clip, cursor, duration))
        cursor += duration + 450
    return "two_person_turns", events


def build_fast_switch(clips: list[list[Clip]]):
    events = []
    cursor = 300
    for index in range(20):
        speaker = index % 2
        clip = clips[speaker][index // 2]
        duration = min(1200, duration_ms(clip.samples))
        events.append(Event(clip, cursor, duration))
        cursor += duration + 120
    return "fast_switch", events


def build_overlap(clips: list[list[Clip]]):
    first = clips[0][0]
    second = clips[1][0]
    third = clips[0][1]
    fourth = clips[1][1]
    first_duration = min(5000, duration_ms(first.samples))
    second_duration = min(5000, duration_ms(second.samples))
    third_duration = min(4200, duration_ms(third.samples))
    fourth_duration = min(4800, duration_ms(fourth.samples))
    return "overlap", [
        Event(first, 500, first_duration),
        Event(second, 500 + first_duration // 2, second_duration),
        Event(third, 8500, third_duration),
        Event(fourth, 8500 + third_duration // 2, fourth_duration),
    ]


def build_four_person(clips: list[list[Clip]]):
    events = []
    cursor = 300
    for index in range(12):
        speaker = index % 4
        clip = clips[speaker][index // 4]
        duration = min(3000, duration_ms(clip.samples))
        events.append(Event(clip, cursor, duration))
        cursor += duration + 300
    return "four_person", events


def build_long(clips: list[list[Clip]], target_ms: int):
    events = []
    cursor = 500
    index = 0
    while cursor + 4200 < target_ms:
        speaker = index % 4
        speaker_clips = clips[speaker]
        clip = speaker_clips[(index // 4) % len(speaker_clips)]
        duration = min(3800, duration_ms(clip.samples))
        events.append(Event(clip, cursor, duration))
        cursor += duration + 400
        index += 1
    return "long_30m", events


def render(path: Path, events: list[Event]) -> int:
    end_ms = max(event.start_ms + event.duration_ms for event in events) + 300
    output = array("h", [0]) * (end_ms * SAMPLE_RATE // 1000)
    for event in events:
        start = event.start_ms * SAMPLE_RATE // 1000
        length = event.duration_ms * SAMPLE_RATE // 1000
        source = event.clip.samples[:length]
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


def duration_ms(samples: array) -> int:
    return len(samples) * 1000 // SAMPLE_RATE


if __name__ == "__main__":
    main()
