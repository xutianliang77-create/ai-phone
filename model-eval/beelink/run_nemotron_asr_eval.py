#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly
from transformers import AutoModelForRNNT, AutoProcessor


LANGUAGE_MAP = {
    "zh": "zh-CN",
    "en": "en-US",
    "mixed": "auto",
}


def main() -> None:
    args = parse_args()
    root = Path(args.root).resolve()
    model_dir = (root / args.model_dir).resolve()
    samples = read_samples(root / args.samples)
    samples = [sample for sample in samples if sample.get("priority") == args.priority]
    if args.limit:
        samples = samples[: args.limit]

    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = (root / args.output_dir / args.provider_id / run_id).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    processor = AutoProcessor.from_pretrained(str(model_dir), local_files_only=True)
    model = load_model(model_dir, args.dtype)
    model.eval()
    sample_rate = processor.feature_extractor.sampling_rate

    all_results: list[dict] = []
    for mode in build_modes(args):
        if mode["kind"] == "streaming":
            processor.set_num_lookahead_tokens(mode["lookahead"])
            mode["streamingLatencyMs"] = getattr(processor, "streaming_latency_ms", None)
        results = []
        for sample in samples:
            wav = audio_path_for_sample(root, sample)
            audio, duration_ms = load_audio(wav, sample_rate)
            language = language_for_sample(sample, mode["languageMode"])
            started = time.perf_counter()
            with torch.inference_mode():
                if mode["kind"] == "streaming":
                    text = transcribe_streaming(processor, model, audio, sample_rate, language)
                else:
                    text = transcribe_offline(processor, model, audio, sample_rate, language)
            latency_ms = round((time.perf_counter() - started) * 1000)
            result = score_result(
                sample=sample,
                provider_id=args.provider_id,
                model_id=args.model_id,
                mode=mode,
                text=text,
                wav=wav,
                duration_ms=duration_ms,
                latency_ms=latency_ms,
                language_prompt=language,
            )
            results.append(result)
            write_jsonl(
                output_dir / f"{sample['id']}-{mode['id']}.jsonl",
                {
                    "type": "transcript.final",
                    "sampleId": sample["id"],
                    "providerId": args.provider_id,
                    "modelId": args.model_id,
                    "mode": mode,
                    "languagePrompt": language,
                    "text": text,
                    "latencyMs": latency_ms,
                },
            )
            print(
                f"{mode['id']} {sample['id']} "
                f"{'pass' if result['acceptable'] else 'fail'} "
                f"{result['metric']}={result['score']} {text}"
            )
        all_results.extend(results)

    summary = summarize(args, run_id, output_dir, all_results)
    write_json(output_dir / "summary.json", summary)
    write_markdown(output_dir / "summary.md", summary)
    print(output_dir)
    print(f"best={summary['bestMode']['modeId']} pass={summary['bestMode']['pass']}/{summary['bestMode']['total']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate NVIDIA Nemotron 3.5 ASR on product P0 corpus.")
    parser.add_argument("--root", default="/data/models/translation-model-eval")
    parser.add_argument(
        "--model-dir",
        default="models/nemotron_3_5_asr_streaming_0_6b_transformers",
    )
    parser.add_argument(
        "--samples",
        default="data/model-eval/iphone14-small-models/iphone14-test-set-v1.jsonl",
    )
    parser.add_argument(
        "--output-dir",
        default="data/model-eval/asr-model-sweep",
    )
    parser.add_argument("--provider-id", default="nemotron_3_5_asr_streaming_0_6b")
    parser.add_argument("--model-id", default="nvidia/nemotron-3.5-asr-streaming-0.6b")
    parser.add_argument("--priority", default="P0")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dtype", choices=["auto", "float16", "bfloat16", "float32"], default="bfloat16")
    parser.add_argument(
        "--modes",
        default="stream_known_80,stream_known_320,stream_known_1120,stream_auto_320",
        help="Comma-separated modes: offline_known, offline_auto, stream_known_80, stream_known_320, stream_known_1120, stream_auto_320, stream_auto_1120.",
    )
    return parser.parse_args()


def build_modes(args: argparse.Namespace) -> list[dict]:
    modes = {
        "offline_known": {
            "id": "offline_known",
            "kind": "offline",
            "languageMode": "known",
            "lookahead": None,
            "chunkMs": None,
        },
        "offline_auto": {
            "id": "offline_auto",
            "kind": "offline",
            "languageMode": "auto",
            "lookahead": None,
            "chunkMs": None,
        },
        "stream_known_80": {
            "id": "stream_known_80",
            "kind": "streaming",
            "languageMode": "known",
            "lookahead": 0,
            "chunkMs": 80,
        },
        "stream_known_320": {
            "id": "stream_known_320",
            "kind": "streaming",
            "languageMode": "known",
            "lookahead": 3,
            "chunkMs": 320,
        },
        "stream_known_1120": {
            "id": "stream_known_1120",
            "kind": "streaming",
            "languageMode": "known",
            "lookahead": 13,
            "chunkMs": 1120,
        },
        "stream_auto_320": {
            "id": "stream_auto_320",
            "kind": "streaming",
            "languageMode": "auto",
            "lookahead": 3,
            "chunkMs": 320,
        },
        "stream_auto_1120": {
            "id": "stream_auto_1120",
            "kind": "streaming",
            "languageMode": "auto",
            "lookahead": 13,
            "chunkMs": 1120,
        },
    }
    selected = []
    for mode_id in [item.strip() for item in args.modes.split(",") if item.strip()]:
        if mode_id not in modes:
            raise ValueError(f"unknown mode: {mode_id}")
        selected.append(dict(modes[mode_id]))
    return selected


def load_model(model_dir: Path, dtype: str):
    kwargs = {"local_files_only": True, "device_map": "cuda:0" if torch.cuda.is_available() else None}
    if dtype == "float16":
        kwargs["torch_dtype"] = torch.float16
    elif dtype == "bfloat16":
        kwargs["torch_dtype"] = torch.bfloat16
    elif dtype == "float32":
        kwargs["torch_dtype"] = torch.float32
    return AutoModelForRNNT.from_pretrained(str(model_dir), **kwargs)


def read_samples(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def audio_path_for_sample(root: Path, sample: dict) -> Path:
    audio_dir = root / "test-audio/iphone14-small-models"
    variant = sample.get("audio", {}).get("variant")
    if variant == "phone_8k":
        return audio_dir / f"{sample['id']}-phone8k.wav"
    if variant == "mild_noise":
        return audio_dir / f"{sample['id']}-mild-noise-24k.wav"
    return audio_dir / f"{sample['id']}-24k.wav"


def language_for_sample(sample: dict, language_mode: str) -> str:
    if language_mode == "auto":
        return "auto"
    return LANGUAGE_MAP.get(sample.get("language"), "auto")


def load_audio(path: Path, target_rate: int) -> tuple[np.ndarray, int]:
    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sample_rate != target_rate:
        divisor = math.gcd(sample_rate, target_rate)
        audio = resample_poly(audio, target_rate // divisor, sample_rate // divisor).astype(np.float32)
    duration_ms = round(len(audio) / target_rate * 1000)
    return audio, duration_ms


def transcribe_offline(processor, model, audio: np.ndarray, sample_rate: int, language: str) -> str:
    inputs = processor(audio, sampling_rate=sample_rate, language=language, return_tensors="pt")
    inputs = inputs.to(model.device, dtype=model.dtype)
    output = model.generate(**inputs, max_new_tokens=512, return_dict_in_generate=True)
    return decoded_text(processor.decode(output.sequences, skip_special_tokens=False))


def transcribe_streaming(processor, model, audio: np.ndarray, sample_rate: int, language: str) -> str:
    def padded_slice(start_idx: int, length: int) -> np.ndarray:
        end_idx = start_idx + length
        left_pad = max(0, -start_idx)
        right_pad = max(0, end_idx - audio.shape[0])
        clip = audio[max(0, start_idx) : min(audio.shape[0], end_idx)]
        if left_pad or right_pad:
            clip = np.pad(clip, (left_pad, right_pad))
        return clip.astype(np.float32, copy=False)

    first_audio = padded_slice(0, processor.num_samples_first_audio_chunk)
    inputs = processor(
        first_audio,
        sampling_rate=sample_rate,
        is_streaming=True,
        is_first_audio_chunk=True,
        language=language,
        return_tensors="pt",
    )
    inputs = inputs.to(model.device, dtype=model.dtype)

    def input_features_generator():
        yield inputs.input_features[:, : processor.num_mel_frames_first_audio_chunk, :]
        mel_frame_idx = processor.num_mel_frames_first_audio_chunk
        hop_length = processor.feature_extractor.hop_length
        n_fft = processor.feature_extractor.n_fft
        if audio.shape[0] <= processor.num_samples_first_audio_chunk:
            return
        start_idx = mel_frame_idx * hop_length - n_fft // 2
        while start_idx < audio.shape[0]:
            chunk_inputs = processor(
                padded_slice(start_idx, processor.num_samples_per_audio_chunk),
                sampling_rate=sample_rate,
                is_streaming=True,
                is_first_audio_chunk=False,
                language=language,
                return_tensors="pt",
            )
            chunk_inputs = chunk_inputs.to(model.device, dtype=model.dtype)
            yield chunk_inputs.input_features
            mel_frame_idx += processor.num_mel_frames_per_audio_chunk
            start_idx = mel_frame_idx * hop_length - n_fft // 2

    generate_kwargs = dict(inputs)
    generate_kwargs["input_features"] = input_features_generator()
    output = model.generate(**generate_kwargs, max_new_tokens=512, return_dict_in_generate=True)
    return decoded_text(processor.decode(output.sequences, skip_special_tokens=False))


def decoded_text(value) -> str:
    if isinstance(value, list):
        return value[0] if value else ""
    return str(value)


def score_result(
    sample: dict,
    provider_id: str,
    model_id: str,
    mode: dict,
    text: str,
    wav: Path,
    duration_ms: int,
    latency_ms: int,
    language_prompt: str,
) -> dict:
    clean_text = clean_language_tags(text)
    metric = "wer" if sample.get("language") == "en" else "cer"
    score = error_rate_for(metric, sample["text"], clean_text)
    return {
        "sampleId": sample["id"],
        "group": sample.get("group"),
        "language": sample.get("language"),
        "providerId": provider_id,
        "modelId": model_id,
        "modeId": mode["id"],
        "mode": mode,
        "languagePrompt": language_prompt,
        "expectedText": sample["text"],
        "rawText": text,
        "finalText": clean_text,
        "metric": metric,
        "score": score,
        "acceptable": score <= (0.3 if metric == "wer" else 0.18),
        "latencyMs": latency_ms,
        "durationMs": duration_ms,
        "rtf": round(latency_ms / max(1, duration_ms), 4),
        "audioPath": str(wav),
    }


def clean_language_tags(text: str) -> str:
    return re.sub(r"<[a-z]{2}(?:-[A-Z]{2})?>", "", text).strip()


def error_rate_for(metric: str, expected: str, actual: str) -> float:
    if metric == "wer":
        expected_items = words(expected)
        actual_items = words(actual)
    else:
        expected_items = chars(expected)
        actual_items = chars(actual)
    return round(edit_distance(expected_items, actual_items) / max(1, len(expected_items)), 4)


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def chars(text: str) -> list[str]:
    normalized = re.sub(r"[\s，。,.!?！？、；;：:\"'“”‘’（）()\\-]", "", text.lower())
    return list(normalized)


def edit_distance(left: list[str], right: list[str]) -> int:
    previous = list(range(len(right) + 1))
    for i, left_item in enumerate(left, 1):
        current = [i]
        for j, right_item in enumerate(right, 1):
            cost = 0 if left_item == right_item else 1
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost))
        previous = current
    return previous[-1]


def summarize(args: argparse.Namespace, run_id: str, output_dir: Path, results: list[dict]) -> dict:
    by_mode: dict[str, dict] = {}
    for result in results:
        row = by_mode.setdefault(
            result["modeId"],
            {
                "modeId": result["modeId"],
                "total": 0,
                "pass": 0,
                "fail": 0,
                "avgLatencyMs": 0,
                "avgRtf": 0,
                "groups": defaultdict(lambda: {"total": 0, "pass": 0, "fail": 0}),
            },
        )
        row["total"] += 1
        row["pass"] += 1 if result["acceptable"] else 0
        row["fail"] += 0 if result["acceptable"] else 1
        row["avgLatencyMs"] += result["latencyMs"]
        row["avgRtf"] += result["rtf"]
        group = row["groups"][result["group"]]
        group["total"] += 1
        group["pass"] += 1 if result["acceptable"] else 0
        group["fail"] += 0 if result["acceptable"] else 1
    for row in by_mode.values():
        row["avgLatencyMs"] = round(row["avgLatencyMs"] / max(1, row["total"]))
        row["avgRtf"] = round(row["avgRtf"] / max(1, row["total"]), 4)
        row["groups"] = dict(row["groups"])
    mode_rows = sorted(by_mode.values(), key=lambda item: (item["pass"], -item["avgLatencyMs"]), reverse=True)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "runId": run_id,
        "providerId": args.provider_id,
        "modelId": args.model_id,
        "modelDir": args.model_dir,
        "priority": args.priority,
        "outputDir": str(output_dir),
        "bestMode": mode_rows[0] if mode_rows else None,
        "modes": mode_rows,
        "results": results,
    }


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def write_jsonl(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False) + "\n")


def write_markdown(path: Path, summary: dict) -> None:
    lines = [
        f"# {summary['modelId']} ASR Eval",
        "",
        f"- Provider: `{summary['providerId']}`",
        f"- Run: `{summary['runId']}`",
        f"- Best mode: `{summary['bestMode']['modeId']}` {summary['bestMode']['pass']}/{summary['bestMode']['total']}",
        "",
        "## Mode Summary",
        "",
        "| Mode | Pass/Total | Avg Latency | Avg RTF |",
        "| --- | ---: | ---: | ---: |",
    ]
    for mode in summary["modes"]:
        lines.append(
            f"| `{mode['modeId']}` | {mode['pass']}/{mode['total']} | "
            f"{mode['avgLatencyMs']} ms | {mode['avgRtf']} |"
        )
    lines.extend(["", "## Best Mode By Group", "", "| Group | Pass/Total |", "| --- | ---: |"])
    for group, row in summary["bestMode"]["groups"].items():
        lines.append(f"| `{group}` | {row['pass']}/{row['total']} |")
    lines.extend(["", "## Best Mode Samples", "", "| Sample | Result | Metric | Text |", "| --- | --- | --- | --- |"])
    best_mode = summary["bestMode"]["modeId"]
    for result in summary["results"]:
        if result["modeId"] != best_mode:
            continue
        lines.append(
            f"| `{result['sampleId']}` | {'pass' if result['acceptable'] else 'fail'} | "
            f"{result['metric']} {result['score']} | {escape_cell(result['finalText'])} |"
        )
    path.write_text("\n".join(lines) + "\n")


def escape_cell(value: str) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


if __name__ == "__main__":
    main()
