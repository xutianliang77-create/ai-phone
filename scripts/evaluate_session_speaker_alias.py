#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate the isolated session-local speaker alias gates.",
    )
    parser.add_argument("--titanet-pairs", type=Path, required=True)
    parser.add_argument("--moss-40plus10", type=Path, required=True)
    parser.add_argument("--moss-session90", type=Path, required=True)
    parser.add_argument("--threshold", type=float, default=0.60)
    parser.add_argument("--minimum-same-accept-rate", type=float, default=0.80)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    titan = load_object(args.titanet_pairs)
    moss_clips = load_object(args.moss_40plus10)
    moss_sessions = load_object(args.moss_session90)

    pair_rows = require_rows(titan, "pairs")
    same = [row for row in pair_rows if row.get("sameSpeaker") is True]
    different = [row for row in pair_rows if row.get("sameSpeaker") is False]
    same_accepted = accepted_count(same, args.threshold)
    false_merges = accepted_count(different, args.threshold)
    same_accept_rate = ratio(same_accepted, len(same))
    channel_score = require_number(titan, "channelShiftSameSpeakerScore")

    clip_rows = require_rows(moss_clips, "rows")
    far = [row for row in clip_rows if row.get("diagnosticOnly") is not True]
    overlap = [row for row in clip_rows if row.get("diagnosticOnly") is True]
    session_rows = require_rows(moss_sessions, "rows")

    result = {
        "schemaVersion": 1,
        "policy": {
            "scope": "session_local_anonymous_alias_only",
            "threshold": args.threshold,
            "minimumEvidenceMs": 1500,
            "overlapEligible": False,
            "mossCanInitiateMerge": False,
            "mossRole": "single-speaker-collapse-veto_only",
        },
        "titanet": {
            "sameSpeakerAccepted": same_accepted,
            "sameSpeakerTotal": len(same),
            "sameSpeakerAcceptRate": same_accept_rate,
            "differentSpeakerFalseMerges": false_merges,
            "differentSpeakerTotal": len(different),
            "channelShiftSameSpeakerScore": channel_score,
            "channelShiftAccepted": channel_score >= args.threshold,
        },
        "moss": {
            "farFieldZeroErrorGuard": summarize_count_rows(far),
            "overlapDiagnosticOnly": summarize_count_rows(overlap),
            "session90VetoCoverage": summarize_count_rows(session_rows),
        },
    }
    result["gates"] = {
        "zeroDifferentSpeakerFalseMerges": false_merges == 0,
        "channelShiftRecovered": channel_score >= args.threshold,
        "sameSpeakerAcceptRate": (
            same_accept_rate >= args.minimum_same_accept_rate
        ),
        "session90CollapseVetoCoverage": (
            result["moss"]["session90VetoCoverage"]["multiDetectedRate"] == 1.0
        ),
        "overlapExcludedFromHardGate": True,
    }
    result["passed"] = all(result["gates"].values())
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


def load_object(path: Path) -> dict:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def require_rows(payload: dict, key: str) -> list[dict]:
    rows = payload.get(key)
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"{key} must be a list of objects")
    return rows


def require_number(payload: dict, key: str) -> float:
    value = payload.get(key)
    if not isinstance(value, (int, float)):
        raise ValueError(f"{key} must be numeric")
    return float(value)


def accepted_count(rows: list[dict], threshold: float) -> int:
    return sum(
        isinstance(row.get("score"), (int, float))
        and float(row["score"]) >= threshold
        for row in rows
    )


def summarize_count_rows(rows: list[dict]) -> dict:
    exact = sum(
        row.get("expectedSpeakerCount") == row.get("mossSpeakerCount")
        for row in rows
    )
    multi = [
        row for row in rows
        if isinstance(row.get("expectedSpeakerCount"), int)
        and row["expectedSpeakerCount"] > 1
    ]
    multi_detected = sum(
        isinstance(row.get("mossSpeakerCount"), int)
        and row["mossSpeakerCount"] > 1
        for row in multi
    )
    false_multi = sum(
        row.get("expectedSpeakerCount") == 1
        and isinstance(row.get("mossSpeakerCount"), int)
        and row["mossSpeakerCount"] > 1
        for row in rows
    )
    return {
        "exact": exact,
        "total": len(rows),
        "multiDetected": multi_detected,
        "multiTotal": len(multi),
        "multiDetectedRate": ratio(multi_detected, len(multi)),
        "falseMulti": false_multi,
    }


def ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 6) if denominator else None


if __name__ == "__main__":
    main()
