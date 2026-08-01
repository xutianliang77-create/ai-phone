#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
from pathlib import Path
import statistics

import numpy as np

from app.session_alias import (
    NemoSpeakerEmbedder,
    encode_pcm16_wav,
    normalized,
    read_pcm16_wav,
    robust_profile_vector,
)


def main() -> None:
    args = parse_args()
    manifest_path = Path(args.manifest)
    rows = read_jsonl(manifest_path)
    by_id = {row["id"]: row for row in rows if row["score_mode"] == "cer"}
    gate = json.loads(Path(args.pair_gate).read_text())
    embedder = NemoSpeakerEmbedder(args.model)
    embedder.load()

    whole_profiles = {}
    controlled = []
    for row in by_id.values():
        audio_path = manifest_path.parent / row["audio_path"]
        audio = audio_path.read_bytes()
        require_hash(audio, row["sha256"], row["id"])
        samples, sample_rate = read_pcm16_wav(audio)
        whole_profiles[row["id"]] = profile_for_audio(
            embedder,
            samples,
            sample_rate,
        )
        if len(samples) < sample_rate * 3:
            continue
        midpoint = len(samples) // 2
        controlled.append({
            "id": row["id"],
            "left": profile_for_stream(
                embedder,
                samples[:midpoint],
                sample_rate,
            ),
            "right": profile_for_stream(
                embedder,
                samples[midpoint:],
                sample_rate,
            ),
        })

    variants = {}
    for name in (
        "anchor",
        "fuse02",
        "fuse05",
        "fuse10",
        "fuse25",
        "fuse50",
        "window",
    ):
        same_scores = []
        different_scores = []
        pair_rows = []
        for pair in gate["pairs"]:
            score = similarity(
                whole_profiles[pair["left"]],
                whole_profiles[pair["right"]],
                name,
            )
            (same_scores if pair["sameSpeaker"] else different_scores).append(
                score,
            )
            pair_rows.append({**pair, "candidateScore": round(score, 8)})
        controlled_scores = [
            similarity(item["left"], item["right"], name)
            for item in controlled
        ]
        variants[name] = {
            "controlled": score_summary(controlled_scores, args.threshold),
            "same": score_summary(same_scores, args.threshold),
            "different": score_summary(different_scores, args.threshold),
            "pairRows": pair_rows,
        }

    eligible = [
        (name, result)
        for name, result in variants.items()
        if result["different"]["accepted"] == 0
    ]
    eligible.sort(
        key=lambda item: (
            item[1]["controlled"]["accepted"],
            item[1]["same"]["accepted"],
        ),
        reverse=True,
    )
    selected = eligible[0][0] if eligible else None
    report = {
        "schemaVersion": 1,
        "manifest": str(manifest_path),
        "manifestSha256": sha256(manifest_path.read_bytes()),
        "pairGate": args.pair_gate,
        "pairGateSha256": sha256(Path(args.pair_gate).read_bytes()),
        "model": args.model,
        "threshold": args.threshold,
        "controlledCount": len(controlled),
        "selectedZeroFalseMergeVariant": selected,
        "variants": variants,
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({
        "selectedZeroFalseMergeVariant": selected,
        "variants": {
            name: {
                "controlled": value["controlled"],
                "same": value["same"],
                "different": value["different"],
            }
            for name, value in variants.items()
        },
    }, indent=2))


def profile_for_audio(embedder, samples, sample_rate):
    anchor, windows = embedder.embedding_components(
        base64.b64encode(encode_pcm16_wav(samples, sample_rate)).decode(),
    )
    return profile(anchor, windows)


def profile_for_stream(embedder, samples, sample_rate):
    chunk_samples = sample_rate * 2
    minimum_samples = sample_rate * 3 // 2
    anchors = []
    window_centroids = []
    for start in range(0, len(samples), chunk_samples):
        chunk = samples[start:start + chunk_samples]
        if len(chunk) < minimum_samples:
            continue
        anchor, windows = embedder.embedding_components(
            base64.b64encode(
                encode_pcm16_wav(chunk, sample_rate),
            ).decode(),
        )
        anchors.append(anchor)
        window_centroids.append(robust_profile_vector(windows))
    return {
        "anchor": normalized(np.mean(np.stack(anchors), axis=0)),
        "window": normalized(np.mean(np.stack(window_centroids), axis=0)),
    }


def profile(anchor, windows):
    return {
        "anchor": normalized(anchor),
        "window": robust_profile_vector(windows),
    }


def similarity(left, right, variant):
    weight = {
        "anchor": 0.0,
        "fuse02": 0.02,
        "fuse05": 0.05,
        "fuse10": 0.1,
        "fuse25": 0.25,
        "fuse50": 0.5,
        "window": 1.0,
    }[variant]
    left_vector = normalized(
        left["anchor"] * (1 - weight) + left["window"] * weight,
    )
    right_vector = normalized(
        right["anchor"] * (1 - weight) + right["window"] * weight,
    )
    return float(np.dot(left_vector, right_vector))


def score_summary(scores, threshold):
    return {
        "count": len(scores),
        "accepted": sum(score >= threshold for score in scores),
        "minimum": round(min(scores), 8),
        "median": round(statistics.median(scores), 8),
        "maximum": round(max(scores), 8),
    }


def read_jsonl(path):
    return [
        json.loads(line)
        for line in path.read_text().splitlines()
        if line.strip()
    ]


def require_hash(value, expected, label):
    actual = sha256(value)
    if actual != expected:
        raise ValueError(f"{label} hash mismatch: {actual}")


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--pair-gate", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--threshold", type=float, default=0.60)
    return parser.parse_args()


if __name__ == "__main__":
    main()
