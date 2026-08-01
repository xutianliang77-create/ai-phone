#!/usr/bin/env python3
import argparse
from itertools import permutations, product
import json
import math
from pathlib import Path


FRAME_SEC = 0.01
DIAR_FRAME_REPEAT = 8


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", nargs="+", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--top", type=int, default=30)
    args = parser.parse_args()

    cases = [
        prepare_case(case)
        for path in args.predictions
        for case in json.loads(Path(path).read_text())["cases"]
    ]
    baseline_params = parameters(0.5, 0.5, 0, 0, 0, 0)
    for case in cases:
        case["baselineDerPercent"] = evaluate_case(case, baseline_params)["derPercent"]
    baseline = evaluate_all(cases, baseline_params)
    candidates = []
    for values in product(
        [0.56, 0.60, 0.64],
        [0.50, 0.56, 0.60],
        [0.00, 0.04],
        [0.00, 0.02],
        [0.00, 0.08, 0.16],
        [0.08, 0.16, 0.24, 0.32],
    ):
        result = evaluate_all(cases, parameters(*values))
        natural = result["natural"]
        meeting = result["meeting"]
        baseline_natural = baseline["natural"]
        if (
            meeting["microDerPercent"] < baseline["meeting"]["microDerPercent"]
            and natural["rawDerPercent"]
            <= baseline_natural["rawDerPercent"] + 1.0
            and natural["collar250DerPercent"] <= 0.5
            and meeting["maxRegressionPoints"] <= 1.0
        ):
            candidates.append(result)
    candidates.sort(key=lambda item: (
        item["meeting"]["microDerPercent"],
        item["natural"]["rawDerPercent"],
        item["meeting"]["segments"],
    ))
    payload = {
        "schemaVersion": 1,
        "cases": [case["id"] for case in cases],
        "gridSize": 3 * 3 * 2 * 2 * 3 * 4,
        "baseline": baseline,
        "passingCandidateCount": len(candidates),
        "topCandidates": candidates[: args.top],
    }
    Path(args.output).write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps(payload, indent=2))


def parameters(
    onset: float,
    offset: float,
    pad_onset: float,
    pad_offset: float,
    min_duration_on: float,
    min_duration_off: float,
) -> dict[str, float]:
    return {
        "onset": onset,
        "offset": offset,
        "padOnset": pad_onset,
        "padOffset": pad_offset,
        "minDurationOn": min_duration_on,
        "minDurationOff": min_duration_off,
    }


def prepare_case(case: dict[str, object]) -> dict[str, object]:
    duration_ms = int(case["durationMs"])
    frame_count = math.ceil(duration_ms / 10)
    speaker_ids = sorted({item["speakerId"] for item in case["reference"]})
    reference = [[False] * frame_count for _ in speaker_ids]
    speaker_index = {speaker: index for index, speaker in enumerate(speaker_ids)}
    for span in case["reference"]:
        start = max(0, int(span["startMs"]) // 10)
        end = min(frame_count, math.ceil(int(span["endMs"]) / 10))
        for frame in range(start, end):
            reference[speaker_index[span["speakerId"]]][frame] = True
    collar_mask = [True] * frame_count
    for span in case["reference"]:
        for boundary_ms in (int(span["startMs"]), int(span["endMs"])):
            start = max(0, (boundary_ms - 250) // 10)
            end = min(frame_count, math.ceil((boundary_ms + 250) / 10))
            for frame in range(start, end):
                collar_mask[frame] = False
    return {
        "id": case["id"],
        "durationMs": duration_ms,
        "probabilities": case["probabilities"],
        "reference": reference,
        "collarMask": collar_mask,
        "natural": "natural" in str(case["id"]),
    }


def evaluate_all(
    cases: list[dict[str, object]],
    params: dict[str, float],
) -> dict[str, object]:
    evaluations = [evaluate_case(case, params) for case in cases]
    meetings = [item for item in evaluations if not item["natural"]]
    naturals = [item for item in evaluations if item["natural"]]
    if len(naturals) != 1:
        raise ValueError("sweep requires exactly one natural-switch case")
    meeting_total = sum(float(item["totalSeconds"]) for item in meetings)
    meeting_error = sum(float(item["errorSeconds"]) for item in meetings)
    baseline_ders = [float(case["baselineDerPercent"]) for case in meetings]
    regressions = [
        float(item["derPercent"]) - baseline_der
        for item, baseline_der in zip(meetings, baseline_ders)
    ]
    natural = naturals[0]
    return {
        "parameters": params,
        "meeting": {
            "microDerPercent": round(100 * meeting_error / meeting_total, 4),
            "macroDerPercent": round(
                sum(float(item["derPercent"]) for item in meetings) / len(meetings),
                4,
            ),
            "maxRegressionPoints": round(max(regressions), 4),
            "segments": sum(int(item["segments"]) for item in meetings),
            "cases": meetings,
        },
        "natural": {
            "rawDerPercent": natural["derPercent"],
            "collar250DerPercent": natural["collar250DerPercent"],
            "segments": natural["segments"],
        },
    }


def evaluate_case(
    case: dict[str, object],
    params: dict[str, float],
) -> dict[str, object]:
    frame_count = math.ceil(int(case["durationMs"]) / 10)
    probabilities = case["probabilities"]
    speaker_count = len(probabilities[0])
    hypothesis = []
    segment_count = 0
    for speaker in range(speaker_count):
        sequence = [
            float(frame[speaker])
            for frame in probabilities
            for _ in range(DIAR_FRAME_REPEAT)
        ][:frame_count]
        segments = postprocess(sequence, params, frame_count)
        segment_count += len(segments)
        mask = [False] * frame_count
        for start, end in segments:
            for frame in range(start, end):
                mask[frame] = True
        hypothesis.append(mask)
    raw = score(case["reference"], hypothesis)
    collar = score(case["reference"], hypothesis, case["collarMask"])
    return {
        "id": case["id"],
        "natural": case["natural"],
        "derPercent": round(100 * raw["error"] / raw["total"], 4),
        "collar250DerPercent": round(100 * collar["error"] / collar["total"], 4),
        "totalSeconds": round(raw["total"] * FRAME_SEC, 4),
        "errorSeconds": round(raw["error"] * FRAME_SEC, 4),
        "segments": segment_count,
        "baselineDerPercent": case.get(
            "baselineDerPercent",
            round(100 * raw["error"] / raw["total"], 4),
        ),
    }


def postprocess(
    sequence: list[float],
    params: dict[str, float],
    frame_count: int,
) -> list[tuple[int, int]]:
    onset = params["onset"]
    offset = params["offset"]
    pad_onset = round(params["padOnset"] / FRAME_SEC)
    pad_offset = round(params["padOffset"] / FRAME_SEC)
    speech = False
    start = 0
    segments = []
    for index, probability in enumerate(sequence):
        if speech:
            if probability < offset:
                end = min(frame_count, index + pad_offset)
                padded_start = max(0, start - pad_onset)
                if end > padded_start:
                    segments.append((padded_start, end))
                speech = False
        elif probability > onset:
            start = index
            speech = True
    if speech:
        segments.append((
            max(0, start - pad_onset),
            min(frame_count, len(sequence) - 1 + pad_offset),
        ))
    segments = merge_segments(segments)
    min_on = round(params["minDurationOn"] / FRAME_SEC)
    if min_on:
        segments = [item for item in segments if item[1] - item[0] >= min_on]
    min_off = round(params["minDurationOff"] / FRAME_SEC)
    if min_off:
        segments = merge_segments(segments, max_gap=min_off)
    return segments


def merge_segments(
    segments: list[tuple[int, int]],
    max_gap: int = 0,
) -> list[tuple[int, int]]:
    merged = []
    for start, end in sorted(segments):
        if merged and start - merged[-1][1] < max_gap:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        elif merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def score(
    reference: list[list[bool]],
    hypothesis: list[list[bool]],
    score_mask: list[bool] | None = None,
) -> dict[str, int]:
    frame_count = len(reference[0])
    mask = score_mask or [True] * frame_count
    size = max(len(reference), len(hypothesis))
    best_correct = -1
    for mapping in permutations(range(size)):
        correct = 0
        for predicted, mapped in enumerate(mapping[: len(hypothesis)]):
            if mapped >= len(reference):
                continue
            correct += sum(
                1
                for frame in range(frame_count)
                if mask[frame]
                and hypothesis[predicted][frame]
                and reference[mapped][frame]
            )
        best_correct = max(best_correct, correct)
    total = error = 0
    for frame in range(frame_count):
        if not mask[frame]:
            continue
        reference_count = sum(item[frame] for item in reference)
        hypothesis_count = sum(item[frame] for item in hypothesis)
        total += reference_count
        error += max(reference_count, hypothesis_count)
    error -= best_correct
    return {"total": total, "error": error}


if __name__ == "__main__":
    main()
