#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import wave
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class VadCase:
    case_id: str
    path: str | None
    expected: str
    category: str
    notes: str
    generator: str | None = None


@dataclass(frozen=True)
class Segment:
    start_ms: int
    end_ms: int
    reason: str


CASES: list[VadCase] = [
    VadCase(
        "vad_001_silence",
        None,
        "no_speech",
        "silence",
        "3s synthetic silence should not open a speech segment",
        "silence",
    ),
    VadCase(
        "vad_002_zh_short_clean",
        "test-audio/iphone14-small-models/zh_short_001-24k.wav",
        "speech",
        "clean",
        "short Mandarin with normal lead/trailing silence",
    ),
    VadCase(
        "vad_003_zh_long_clean",
        "test-audio/iphone14-small-models/zh_long_002-24k.wav",
        "speech",
        "long",
        "long Mandarin sentence should not lose the opening",
    ),
    VadCase(
        "vad_004_zh_fast_clean",
        "test-audio/iphone14-small-models/zh_fast_002-24k.wav",
        "speech",
        "fast",
        "fast Mandarin speech stresses endpoint timing",
    ),
    VadCase(
        "vad_005_noise_only",
        None,
        "no_speech",
        "noise",
        "3s synthetic low noise should not become speech",
        "low_noise",
    ),
    VadCase(
        "vad_005b_medium_noise_only",
        None,
        "no_speech",
        "noise",
        "3s synthetic medium noise probes low-threshold false positives",
        "medium_noise",
    ),
    VadCase(
        "vad_005c_loud_noise_only",
        None,
        "no_speech",
        "noise",
        "3s synthetic loud non-speech noise probes RMS-only weakness",
        "loud_noise",
    ),
    VadCase(
        "vad_006_zh_noise",
        "test-audio/iphone14-small-models/noise_001-mild-noise-24k.wav",
        "speech",
        "noise",
        "speech with mild background noise",
    ),
    VadCase(
        "vad_007_phone8k",
        "test-audio/iphone14-small-models/zh_short_001-phone8k.wav",
        "speech",
        "phone8k",
        "8k telephony-band speech must still open VAD",
    ),
    VadCase(
        "vad_008_tts_echo",
        "test-audio/iphone14-small-models/tts_001-24k.wav",
        "no_speech",
        "tts_echo_proxy",
        "self TTS playback should be blocked before it re-enters ASR",
    ),
    VadCase(
        "vad_009_low_capture",
        "data/model-eval/iphone14-small-models/results/tmp/last-remote-asr-capture-pull-20260707T162452Z.wav",
        "speech",
        "real_device_low_capture",
        "real iPhone capture that exposed low RMS/VAD sensitivity issues",
    ),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate RMS VAD endpoint behavior.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--output-dir", default="data/model-eval/vad")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--engine", choices=["rms", "marblenet", "both"], default="rms")
    parser.add_argument("--case-mode", choices=["core", "full"], default="core")
    parser.add_argument("--thresholds", default="350,197,180,120")
    parser.add_argument("--prob-thresholds", default="0.5,0.7,0.3")
    parser.add_argument(
        "--marblenet-model",
        default="models/frame_vad_multilingual_marblenet_v2/frame_vad_multilingual_marblenet_v2.0.nemo",
    )
    parser.add_argument("--chunk-ms", type=int, default=320)
    parser.add_argument("--min-audio-ms", type=int, default=1800)
    parser.add_argument("--endpoint-silence-ms", type=int, default=1100)
    parser.add_argument("--max-audio-ms", type=int, default=10000)
    parser.add_argument("--preroll-ms", type=int, default=400)
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = (project_root / args.output_dir / run_id).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    thresholds = [int(item.strip()) for item in args.thresholds.split(",") if item.strip()]
    prob_thresholds = [
        float(item.strip()) for item in args.prob_thresholds.split(",") if item.strip()
    ]
    rows: list[dict[str, object]] = []
    cases = build_cases(project_root, args.case_mode)
    if args.engine in {"rms", "both"}:
        for threshold in thresholds:
            for case in cases:
                samples, sample_rate = load_case_audio(project_root, case)
                result = evaluate_rms_vad(
                    samples=samples,
                    sample_rate=sample_rate,
                    threshold=threshold,
                    chunk_ms=args.chunk_ms,
                    min_audio_ms=args.min_audio_ms,
                    endpoint_silence_ms=args.endpoint_silence_ms,
                    max_audio_ms=args.max_audio_ms,
                    preroll_ms=args.preroll_ms,
                )
                rows.append(base_row(run_id, "rms", str(threshold), case, result))
    if args.engine in {"marblenet", "both"}:
        model = load_marblenet_model(project_root / args.marblenet_model)
        for threshold in prob_thresholds:
            for case in cases:
                samples, sample_rate = load_case_audio(project_root, case)
                result = evaluate_marblenet_vad(
                    model=model,
                    samples=samples,
                    sample_rate=sample_rate,
                    prob_threshold=threshold,
                    min_audio_ms=args.min_audio_ms,
                    endpoint_silence_ms=args.endpoint_silence_ms,
                    max_audio_ms=args.max_audio_ms,
                    preroll_ms=args.preroll_ms,
                )
                rows.append(base_row(run_id, "marblenet", str(threshold), case, result))

    write_json(output_dir / "vad-results.json", rows)
    write_csv(output_dir / "vad-results.csv", rows)
    write_json(output_dir / "summary.json", summarize(rows, args))
    write_markdown(output_dir / "report.md", rows, args)
    print(output_dir)
    print_report(rows, args)


def build_cases(project_root: Path, case_mode: str) -> list[VadCase]:
    if case_mode == "core":
        return CASES
    audio_dir = project_root / "test-audio/iphone14-small-models"
    if not audio_dir.exists():
        raise FileNotFoundError(audio_dir)
    cases: list[VadCase] = [
        VadCase(
            "synthetic_silence",
            None,
            "no_speech",
            "silence",
            "3s synthetic silence should not open a speech segment",
            "silence",
        ),
        VadCase(
            "synthetic_low_noise",
            None,
            "no_speech",
            "noise",
            "3s synthetic low noise should not become speech",
            "low_noise",
        ),
        VadCase(
            "synthetic_medium_noise",
            None,
            "no_speech",
            "noise",
            "3s synthetic medium noise probes low-threshold false positives",
            "medium_noise",
        ),
        VadCase(
            "synthetic_loud_noise",
            None,
            "no_speech",
            "noise",
            "3s synthetic loud non-speech noise probes RMS-only weakness",
            "loud_noise",
        ),
    ]
    for path in sorted(audio_dir.glob("*.wav")):
        name = path.name
        rel = str(path.relative_to(project_root))
        expected = "no_speech" if name.startswith("tts_") else "speech"
        category = infer_category(name)
        notes = "full corpus audio"
        if expected == "no_speech":
            notes = "self TTS playback proxy; should be blocked by playback gate"
        cases.append(VadCase(path.stem, rel, expected, category, notes))
    return cases


def infer_category(name: str) -> str:
    if name.startswith("tts_"):
        return "tts_echo_proxy"
    if "phone8k" in name:
        return "phone8k"
    if "mild-noise" in name:
        return "noise"
    if name.startswith("mixed_"):
        return "mixed"
    if name.startswith("zh_fast"):
        return "fast"
    if name.startswith("zh_long") or name.startswith("en_long"):
        return "long"
    if name.startswith("diar_"):
        return "multi_speaker"
    if name.startswith("phone_"):
        return "phone_phrase"
    if name.startswith("offline_"):
        return "offline"
    if name.startswith("noise_"):
        return "noise"
    return "clean"


def base_row(
    run_id: str,
    engine: str,
    threshold: str,
    case: VadCase,
    result: dict[str, object],
) -> dict[str, object]:
    return {
        "runId": run_id,
        "engine": engine,
        "threshold": threshold,
        "caseId": case.case_id,
        "category": case.category,
        "expected": case.expected,
        "notes": case.notes,
        **result,
    }


def load_case_audio(project_root: Path, case: VadCase) -> tuple[list[int], int]:
    if case.generator == "silence":
        return [0] * (16_000 * 3), 16_000
    if case.generator == "low_noise":
        return generate_noise(sample_rate=16_000, seconds=3, peak=60)
    if case.generator == "medium_noise":
        return generate_noise(sample_rate=16_000, seconds=3, peak=250)
    if case.generator == "loud_noise":
        return generate_noise(sample_rate=16_000, seconds=3, peak=450)
    if case.path is None:
        raise ValueError(f"{case.case_id} has no path or generator")
    return load_wav(project_root / case.path)


def generate_noise(*, sample_rate: int, seconds: int, peak: int) -> tuple[list[int], int]:
    samples = []
    seed = 17
    width = peak * 2 + 1
    for _ in range(sample_rate * seconds):
        seed = (1103515245 * seed + 12345) & 0x7FFFFFFF
        samples.append((seed % width) - peak)
    return samples, sample_rate


def load_wav(path: Path) -> tuple[list[int], int]:
    if not path.exists():
        raise FileNotFoundError(path)
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frame_count = wav.getnframes()
        raw = wav.readframes(frame_count)
    if sample_width != 2:
        raise ValueError(f"Only PCM16 WAV is supported: {path} width={sample_width}")
    ints = [
        int.from_bytes(raw[i:i + 2], "little", signed=True)
        for i in range(0, len(raw), 2)
    ]
    if channels <= 1:
        return ints, sample_rate
    mono: list[int] = []
    for i in range(0, len(ints), channels):
        frame = ints[i:i + channels]
        if len(frame) == channels:
            mono.append(round(sum(frame) / channels))
    return mono, sample_rate


def evaluate_rms_vad(
    *,
    samples: list[int],
    sample_rate: int,
    threshold: int,
    chunk_ms: int,
    min_audio_ms: int,
    endpoint_silence_ms: int,
    max_audio_ms: int,
    preroll_ms: int,
) -> dict[str, object]:
    chunk_size = max(1, round(sample_rate * chunk_ms / 1000))
    preroll_chunks: list[tuple[int, int, int, int]] = []
    active_chunks: list[tuple[int, int, int, int]] = []
    segments: list[Segment] = []
    voiced_frames = 0
    frame_rms_values: list[int] = []
    first_voiced_ms: int | None = None
    last_voiced_end_ms: int | None = None
    has_voice = False
    buffered_ms = 0
    trailing_silence_ms = 0
    start_ms = 0

    for frame_index, start in enumerate(range(0, len(samples), chunk_size)):
        chunk = samples[start:start + chunk_size]
        if not chunk:
            continue
        frame_start_ms = round(start * 1000 / sample_rate)
        frame_duration_ms = round(len(chunk) * 1000 / sample_rate)
        frame_end_ms = frame_start_ms + frame_duration_ms
        rms = pcm16_rms(chunk)
        frame_rms_values.append(rms)
        voiced = rms > threshold
        if voiced:
            voiced_frames += 1
            if first_voiced_ms is None:
                first_voiced_ms = frame_start_ms
            last_voiced_end_ms = frame_end_ms

        packed = (frame_start_ms, frame_end_ms, frame_duration_ms, rms)
        if not has_voice:
            if not voiced:
                preroll_chunks.append(packed)
                preroll_chunks = trim_preroll(preroll_chunks, preroll_ms)
                continue
            has_voice = True
            active_chunks = [*preroll_chunks, packed]
            start_ms = active_chunks[0][0]
            preroll_chunks = []
            buffered_ms = sum(item[2] for item in active_chunks)
            trailing_silence_ms = 0
        else:
            active_chunks.append(packed)
            buffered_ms += frame_duration_ms
            trailing_silence_ms = 0 if voiced else trailing_silence_ms + frame_duration_ms

        has_endpoint = trailing_silence_ms >= endpoint_silence_ms
        reached_min = buffered_ms >= min_audio_ms
        reached_max = buffered_ms >= max_audio_ms
        if (reached_min and has_endpoint) or reached_max:
            reason = "endpoint_silence" if has_endpoint else "max_audio"
            segments.append(Segment(start_ms=start_ms, end_ms=frame_end_ms, reason=reason))
            has_voice = False
            buffered_ms = 0
            trailing_silence_ms = 0
            active_chunks = []

    if has_voice and active_chunks:
        segments.append(Segment(
            start_ms=start_ms,
            end_ms=active_chunks[-1][1],
            reason="flush_at_end",
        ))

    duration_ms = round(len(samples) * 1000 / sample_rate) if sample_rate else 0
    max_rms = max(frame_rms_values) if frame_rms_values else 0
    avg_rms = round(sum(frame_rms_values) / len(frame_rms_values), 2) if frame_rms_values else 0
    speech_frame_ratio = round(voiced_frames / len(frame_rms_values), 4) if frame_rms_values else 0
    detected = len(segments) > 0
    return {
        "sampleRate": sample_rate,
        "durationMs": duration_ms,
        "frameCount": len(frame_rms_values),
        "voicedFrameCount": voiced_frames,
        "speechFrameRatio": speech_frame_ratio,
        "maxRms": max_rms,
        "avgFrameRms": avg_rms,
        "firstVoicedMs": first_voiced_ms,
        "lastVoicedEndMs": last_voiced_end_ms,
        "segmentCount": len(segments),
        "segments": [segment.__dict__ for segment in segments],
        "detectedSpeech": detected,
        "falsePositive": detected,
    }


def load_marblenet_model(model_path: Path):
    if not model_path.exists():
        raise FileNotFoundError(model_path)
    import torch
    from nemo.core import typecheck
    from nemo.collections.asr.models import EncDecFrameClassificationModel

    typecheck.set_typecheck_enabled(False)
    try:
        model = EncDecFrameClassificationModel.restore_from(
            str(model_path),
            strict=False,
            map_location="cpu",
        )
    except TypeError:
        model = EncDecFrameClassificationModel.restore_from(
            str(model_path),
            map_location="cpu",
        )
    model.eval()
    torch.set_grad_enabled(False)
    return model


def evaluate_marblenet_vad(
    *,
    model,
    samples: list[int],
    sample_rate: int,
    prob_threshold: float,
    min_audio_ms: int,
    endpoint_silence_ms: int,
    max_audio_ms: int,
    preroll_ms: int,
) -> dict[str, object]:
    import torch

    source_duration_ms = round(len(samples) * 1000 / sample_rate) if sample_rate else 0
    resampled = resample_linear(samples, sample_rate, 16_000)
    if not resampled:
        probs: list[float] = []
    else:
        signal = torch.tensor(
            [[max(-1.0, min(1.0, sample / 32768.0)) for sample in resampled]],
            dtype=torch.float32,
        )
        length = torch.tensor([signal.shape[1]], dtype=torch.long)
        with torch.no_grad():
            logits = model.forward(input_signal=signal, input_signal_length=length)
            probs = torch.softmax(logits, dim=-1)[0, :, 1].detach().cpu().tolist()

    frame_ms = source_duration_ms / len(probs) if probs else 0
    segments = segment_voiced_frames(
        voiced=[prob >= prob_threshold for prob in probs],
        frame_ms=frame_ms,
        min_audio_ms=min_audio_ms,
        endpoint_silence_ms=endpoint_silence_ms,
        max_audio_ms=max_audio_ms,
        preroll_ms=preroll_ms,
    )
    voiced_frames = sum(1 for prob in probs if prob >= prob_threshold)
    max_prob = round(max(probs), 4) if probs else 0
    avg_prob = round(sum(probs) / len(probs), 4) if probs else 0
    rms_values = frame_rms_values(samples=samples, sample_rate=sample_rate, frame_ms=320)
    detected = len(segments) > 0
    first_voiced_ms = None
    last_voiced_end_ms = None
    for idx, prob in enumerate(probs):
        if prob >= prob_threshold:
            first_voiced_ms = round(idx * frame_ms)
            break
    for idx in range(len(probs) - 1, -1, -1):
        if probs[idx] >= prob_threshold:
            last_voiced_end_ms = round((idx + 1) * frame_ms)
            break
    return {
        "sampleRate": sample_rate,
        "durationMs": source_duration_ms,
        "frameCount": len(probs),
        "voicedFrameCount": voiced_frames,
        "speechFrameRatio": round(voiced_frames / len(probs), 4) if probs else 0,
        "maxRms": max(rms_values) if rms_values else 0,
        "avgFrameRms": round(sum(rms_values) / len(rms_values), 2) if rms_values else 0,
        "maxSpeechProb": max_prob,
        "avgSpeechProb": avg_prob,
        "firstVoicedMs": first_voiced_ms,
        "lastVoicedEndMs": last_voiced_end_ms,
        "segmentCount": len(segments),
        "segments": [segment.__dict__ for segment in segments],
        "detectedSpeech": detected,
        "falsePositive": detected,
    }


def segment_voiced_frames(
    *,
    voiced: list[bool],
    frame_ms: float,
    min_audio_ms: int,
    endpoint_silence_ms: int,
    max_audio_ms: int,
    preroll_ms: int,
) -> list[Segment]:
    segments: list[Segment] = []
    preroll: list[int] = []
    active = False
    start_ms = 0
    buffered_ms = 0
    trailing_silence_ms = 0
    max_preroll_frames = max(0, round(preroll_ms / frame_ms)) if frame_ms else 0

    for idx, is_voiced in enumerate(voiced):
        frame_start_ms = round(idx * frame_ms)
        frame_end_ms = round((idx + 1) * frame_ms)
        current_frame_ms = max(1, frame_end_ms - frame_start_ms)
        if not active:
            if not is_voiced:
                preroll.append(idx)
                if len(preroll) > max_preroll_frames:
                    preroll = preroll[-max_preroll_frames:]
                continue
            active = True
            start_idx = preroll[0] if preroll else idx
            start_ms = round(start_idx * frame_ms)
            buffered_ms = frame_end_ms - start_ms
            trailing_silence_ms = 0
            preroll = []
        else:
            buffered_ms += current_frame_ms
            trailing_silence_ms = 0 if is_voiced else trailing_silence_ms + current_frame_ms

        has_endpoint = trailing_silence_ms >= endpoint_silence_ms
        reached_min = buffered_ms >= min_audio_ms
        reached_max = buffered_ms >= max_audio_ms
        if (reached_min and has_endpoint) or reached_max:
            reason = "endpoint_silence" if has_endpoint else "max_audio"
            segments.append(Segment(start_ms=start_ms, end_ms=frame_end_ms, reason=reason))
            active = False
            buffered_ms = 0
            trailing_silence_ms = 0
            preroll = []

    if active:
        segments.append(Segment(
            start_ms=start_ms,
            end_ms=round(len(voiced) * frame_ms),
            reason="flush_at_end",
        ))
    return segments


def resample_linear(samples: list[int], source_rate: int, target_rate: int) -> list[int]:
    if source_rate <= 0 or target_rate <= 0 or not samples:
        return []
    if source_rate == target_rate:
        return samples
    out_len = max(1, round(len(samples) * target_rate / source_rate))
    ratio = source_rate / target_rate
    out: list[int] = []
    for i in range(out_len):
        pos = i * ratio
        left = int(pos)
        right = min(left + 1, len(samples) - 1)
        frac = pos - left
        value = samples[left] * (1 - frac) + samples[right] * frac
        out.append(round(value))
    return out


def frame_rms_values(*, samples: list[int], sample_rate: int, frame_ms: int) -> list[int]:
    if sample_rate <= 0:
        return []
    chunk_size = max(1, round(sample_rate * frame_ms / 1000))
    return [
        pcm16_rms(samples[start:start + chunk_size])
        for start in range(0, len(samples), chunk_size)
        if samples[start:start + chunk_size]
    ]


def trim_preroll(chunks: list[tuple[int, int, int, int]], max_ms: int) -> list[tuple[int, int, int, int]]:
    trimmed = list(chunks)
    while sum(item[2] for item in trimmed) > max_ms:
        trimmed.pop(0)
    return trimmed


def pcm16_rms(samples: Iterable[int]) -> int:
    values = list(samples)
    if not values:
        return 0
    return int(math.sqrt(sum(sample * sample for sample in values) / len(values)))


def summarize(rows: list[dict[str, object]], args: argparse.Namespace) -> dict[str, object]:
    by_threshold: dict[str, dict[str, object]] = {}
    for row in rows:
        threshold = f"{row['engine']}:{row['threshold']}"
        bucket = by_threshold.setdefault(threshold, {
            "engine": row["engine"],
            "threshold": row["threshold"],
            "speechCases": 0,
            "speechDetected": 0,
            "noSpeechCases": 0,
            "falsePositive": 0,
            "totalSegments": 0,
        })
        if row["expected"] == "speech":
            bucket["speechCases"] = int(bucket["speechCases"]) + 1
            if row["detectedSpeech"]:
                bucket["speechDetected"] = int(bucket["speechDetected"]) + 1
        else:
            bucket["noSpeechCases"] = int(bucket["noSpeechCases"]) + 1
            if row["detectedSpeech"]:
                bucket["falsePositive"] = int(bucket["falsePositive"]) + 1
        bucket["totalSegments"] = int(bucket["totalSegments"]) + int(row["segmentCount"])
    for bucket in by_threshold.values():
        speech_cases = int(bucket["speechCases"])
        no_speech_cases = int(bucket["noSpeechCases"])
        bucket["speechRecall"] = round(int(bucket["speechDetected"]) / speech_cases, 4) if speech_cases else None
        bucket["falsePositiveRate"] = round(int(bucket["falsePositive"]) / no_speech_cases, 4) if no_speech_cases else None
    return {
        "engine": "rms",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "params": {
            "chunkMs": args.chunk_ms,
            "minAudioMs": args.min_audio_ms,
            "endpointSilenceMs": args.endpoint_silence_ms,
            "maxAudioMs": args.max_audio_ms,
            "prerollMs": args.preroll_ms,
        },
        "byThreshold": list(by_threshold.values()),
    }


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        return
    fieldnames = [key for key in rows[0].keys() if key != "segments"] + ["segments"]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            out = dict(row)
            out["segments"] = json.dumps(out["segments"], ensure_ascii=False)
            writer.writerow(out)


def write_markdown(path: Path, rows: list[dict[str, object]], args: argparse.Namespace) -> None:
    summary = summarize(rows, args)
    lines = [
        "# VAD Evaluation Report",
        "",
        f"- Created: {summary['createdAt']}",
        f"- Params: chunk={args.chunk_ms}ms, min={args.min_audio_ms}ms, silence={args.endpoint_silence_ms}ms, max={args.max_audio_ms}ms, preroll={args.preroll_ms}ms",
        "",
        "## Summary",
        "",
        "| Engine | Threshold | Speech Recall | False Positive Rate | Segments |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for bucket in summary["byThreshold"]:
        lines.append(
            f"| {bucket['engine']} | {bucket['threshold']} | {bucket['speechDetected']}/{bucket['speechCases']} ({bucket['speechRecall']}) | "
            f"{bucket['falsePositive']}/{bucket['noSpeechCases']} ({bucket['falsePositiveRate']}) | {bucket['totalSegments']} |"
        )
    lines.extend([
        "",
        "## Cases",
        "",
        "| Engine | Threshold | Case | Expected | Detected | First voiced ms | Segments | Max RMS | Avg RMS | Max prob | Avg prob |",
        "| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ])
    for row in rows:
        lines.append(
            f"| {row['engine']} | {row['threshold']} | {row['caseId']} | {row['expected']} | {row['detectedSpeech']} | "
            f"{row['firstVoicedMs']} | {row['segmentCount']} | {row['maxRms']} | {row['avgFrameRms']} | "
            f"{row.get('maxSpeechProb', '')} | {row.get('avgSpeechProb', '')} |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_report(rows: list[dict[str, object]], args: argparse.Namespace) -> None:
    summary = summarize(rows, args)
    for bucket in summary["byThreshold"]:
        print(
            f"engine={bucket['engine']} threshold={bucket['threshold']} "
            f"speech={bucket['speechDetected']}/{bucket['speechCases']} "
            f"false_positive={bucket['falsePositive']}/{bucket['noSpeechCases']} "
            f"segments={bucket['totalSegments']}"
        )


if __name__ == "__main__":
    main()
