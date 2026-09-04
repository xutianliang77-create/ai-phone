#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", nargs="+", required=True)
    parser.add_argument("--predictions", required=True)
    parser.add_argument("--output")
    parser.add_argument("--max-der", type=float, default=0.20)
    parser.add_argument("--max-latency-ms", type=int, default=1200)
    args = parser.parse_args()

    suite = load_suites(args.suite)
    prediction_payload = json.loads(Path(args.predictions).read_text())
    cases = prediction_cases(prediction_payload, suite)
    results = [
        evaluate_case(
            case,
            predictions,
            args.max_der,
            args.max_latency_ms,
        )
        for case, predictions in cases
    ]
    report = {
        "schemaVersion": 1,
        "thresholds": {
            "maxDer": args.max_der,
            "maxEvidenceLatencyMs": args.max_latency_ms,
            "maxConfusionSeconds": 0,
        },
        "cases": results,
        "passed": all(item["passed"] for item in results),
    }
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(rendered)
    print(rendered, end="")


def prediction_cases(payload, suite):
    suite_by_id = {case["id"]: case for case in suite["cases"]}
    if "cases" in payload:
        return [
            (suite_by_id[item["id"]], item["predicted"])
            for item in payload["cases"]
        ]
    if len(suite_by_id) != 1:
        raise ValueError("single prediction payload requires a one-case suite")
    return [(next(iter(suite_by_id.values())), payload["predicted"])]


def load_suites(paths: list[str]) -> dict[str, object]:
    cases = [
        case
        for path in paths
        for case in json.loads(Path(path).read_text())["cases"]
    ]
    case_ids = [case["id"] for case in cases]
    if len(case_ids) != len(set(case_ids)):
        raise ValueError("suite case ids must be unique")
    return {"cases": cases}


def evaluate_case(case, predictions, max_der: float, max_latency_ms: int):
    from pyannote.metrics.diarization import DiarizationErrorRate

    reference = annotation(case["reference"])
    hypothesis = annotation(predictions)
    raw = DiarizationErrorRate(collar=0.0, skip_overlap=False)(
        reference,
        hypothesis,
        detailed=True,
    )
    collar = DiarizationErrorRate(collar=0.25, skip_overlap=False)(
        reference,
        hypothesis,
        detailed=True,
    )
    raw_der = float(raw["diarization error rate"])
    evidence_latencies = sorted(
        max(0, item["firstObservedAudioMs"] - item["startMs"])
        for item in predictions
        if isinstance(item.get("firstObservedAudioMs"), int)
    )
    evidence_p95_ms = percentile(evidence_latencies, 0.95)
    return {
        "id": case["id"],
        "raw": metric_values(raw),
        "collar250ms": metric_values(collar),
        "speakerCount": len({item["speakerId"] for item in predictions}),
        "evidenceLatencyP95Ms": evidence_p95_ms,
        "passed": (
            raw_der <= max_der
            and float(raw["confusion"]) == 0.0
            and (evidence_p95_ms is None or evidence_p95_ms <= max_latency_ms)
        ),
    }


def annotation(spans):
    from pyannote.core import Annotation, Segment

    result = Annotation()
    grouped = {}
    for span in spans:
        grouped.setdefault(span["speakerId"], []).append(
            (span["startMs"], span["endMs"]),
        )
    index = 0
    for speaker_id, intervals in grouped.items():
        for start_ms, end_ms in merge_intervals(intervals):
            result[
                Segment(start_ms / 1000, end_ms / 1000),
                index,
            ] = speaker_id
            index += 1
    return result


def merge_intervals(intervals):
    merged = []
    for start_ms, end_ms in sorted(intervals):
        if merged and start_ms <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end_ms))
        else:
            merged.append((start_ms, end_ms))
    return merged


def metric_values(values):
    return {
        "derPercent": round(float(values["diarization error rate"]) * 100, 4),
        "totalSeconds": round(float(values["total"]), 4),
        "missSeconds": round(float(values["missed detection"]), 4),
        "falseAlarmSeconds": round(float(values["false alarm"]), 4),
        "confusionSeconds": round(float(values["confusion"]), 4),
    }


def percentile(values: list[int], fraction: float) -> int | None:
    if not values:
        return None
    index = max(0, min(len(values) - 1, int(len(values) * fraction + 0.9999) - 1))
    return values[index]


if __name__ == "__main__":
    main()
