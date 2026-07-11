#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", required=True)
    parser.add_argument("--predictions", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()

    suite = json.loads(Path(args.suite).read_text())
    prediction_payload = json.loads(Path(args.predictions).read_text())
    cases = prediction_cases(prediction_payload, suite)
    results = [evaluate_case(case, predictions) for case, predictions in cases]
    report = {
        "schemaVersion": 1,
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


def evaluate_case(case, predictions):
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
            raw_der <= 0.20
            and float(raw["confusion"]) == 0.0
            and (evidence_p95_ms is None or evidence_p95_ms <= 1200)
        ),
    }


def annotation(spans):
    from pyannote.core import Annotation, Segment

    result = Annotation()
    for index, span in enumerate(spans):
        result[
            Segment(span["startMs"] / 1000, span["endMs"] / 1000),
            index,
        ] = span["speakerId"]
    return result


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
