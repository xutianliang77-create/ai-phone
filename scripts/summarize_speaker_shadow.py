#!/usr/bin/env python3
import argparse
import json
from collections import defaultdict
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", required=True)
    parser.add_argument("--output")
    parser.add_argument("--window-minutes", type=int, default=5)
    args = parser.parse_args()

    payload = json.loads(Path(args.predictions).read_text())
    spans = sorted(
        payload.get("predicted", []),
        key=lambda item: (item["startMs"], item["endMs"]),
    )
    report = summarize(
        spans,
        int(payload.get("durationMs", 0)),
        max(1, args.window_minutes) * 60_000,
    )
    report.update({
        "schemaVersion": 1,
        "sourcePredictions": str(Path(args.predictions).resolve()),
        "groundTruthAvailable": False,
        "der": None,
        "limitations": [
            "No RTTM ground truth; speaker identity accuracy and DER are unknown.",
            "Speaker counts and switches are shadow diagnostics, not quality claims.",
        ],
    })
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(rendered)
    print(rendered, end="")


def summarize(spans, duration_ms: int, window_ms: int):
    by_speaker = defaultdict(list)
    for span in spans:
        by_speaker[span["speakerId"]].append(span)
    short_non_overlap = sum(
        span["endMs"] - span["startMs"] < 400 and not span.get("overlap", False)
        for span in spans
    )
    short_overlap = sum(
        span["endMs"] - span["startMs"] < 400 and span.get("overlap") is True
        for span in spans
    )
    overlap_intervals = [
        (span["startMs"], span["endMs"])
        for span in spans
        if span.get("overlap") is True
    ]
    timeline_intervals = [
        (span["startMs"], span["endMs"])
        for span in spans
    ]
    switches = sum(
        left["speakerId"] != right["speakerId"]
        for left, right in zip(spans, spans[1:])
    )
    return {
        "durationMs": duration_ms,
        "segmentCount": len(spans),
        "speakerCount": len(by_speaker),
        "speakers": {
            speaker: {
                "segmentCount": len(items),
                "activityMs": sum(item["endMs"] - item["startMs"] for item in items),
                "firstStartMs": min(item["startMs"] for item in items),
                "lastEndMs": max(item["endMs"] for item in items),
            }
            for speaker, items in sorted(by_speaker.items())
        },
        "timelineActivityMs": union_duration(timeline_intervals),
        "overlapMarkedMs": union_duration(overlap_intervals),
        "shortNonOverlapSegmentCount": short_non_overlap,
        "shortNonOverlapSegmentRate": (
            round(short_non_overlap / len(spans), 4) if spans else 0
        ),
        "shortOverlapSegmentCount": short_overlap,
        "speakerSwitchCount": switches,
        "windowSpeakerCounts": window_speaker_counts(spans, duration_ms, window_ms),
    }


def union_duration(intervals) -> int:
    total = 0
    current = None
    for start, end in sorted(intervals):
        if current is None:
            current = [start, end]
        elif start <= current[1]:
            current[1] = max(current[1], end)
        else:
            total += current[1] - current[0]
            current = [start, end]
    return total if current is None else total + current[1] - current[0]


def window_speaker_counts(spans, duration_ms: int, window_ms: int):
    windows = []
    for start in range(0, duration_ms, window_ms):
        end = min(duration_ms, start + window_ms)
        speakers = sorted({
            span["speakerId"]
            for span in spans
            if span["endMs"] > start and span["startMs"] < end
        })
        windows.append({
            "startMs": start,
            "endMs": end,
            "speakerCount": len(speakers),
            "speakers": speakers,
        })
    return windows


if __name__ == "__main__":
    main()
