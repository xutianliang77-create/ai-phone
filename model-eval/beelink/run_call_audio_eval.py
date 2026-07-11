#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly


CASES = [
    {
        "id": "zh_qwen_short",
        "language": "Chinese",
        "source": "outputs/qwen3-tts-smoke.wav",
        "expected": "今天下午三点我们在会议室讨论产品计划",
        "variants": ["wideband16k", "phone8k_up16k", "phone8k_up16k_snr15"],
    },
    {
        "id": "zh_cosy_long",
        "language": "Chinese",
        "source": "outputs/cosyvoice2-zh-zero-shot-stream.wav",
        "expected": "今天下午三点我们在会议室讨论产品计划之后我会整理会议记录发给大家",
        "variants": ["wideband16k", "phone8k_up16k"],
    },
    {
        "id": "en_cosy_short",
        "language": "English",
        "source": "outputs/cosyvoice2-en-cross-lingual-stream.wav",
        "expected": "This is a realtime translation test please speak clearly and naturally",
        "variants": ["wideband16k", "phone8k_up16k", "phone8k_up16k_snr15"],
    },
]

QWEN_SAMPLE_IDS = {
    "zh_qwen_short:wideband16k",
    "zh_qwen_short:phone8k_up16k",
    "en_cosy_short:wideband16k",
    "en_cosy_short:phone8k_up16k",
}


def main():
    args = parse_args()
    root = Path(args.root)
    output_dir = root / "outputs" / "call-audio-eval"
    output_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    audio_cases = prepare_audio_cases(root, output_dir)
    fire_red_results = run_firered(root, audio_cases)
    qwen_results = [] if args.skip_qwen else run_qwen(root, audio_cases)

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "root": str(root),
        "audioCases": audio_cases,
        "asr": {
            "fireredasr2_aed": fire_red_results,
            "qwen3_asr": qwen_results,
        },
        "summary": summarize(fire_red_results, qwen_results),
    }
    output_path = root / "outputs" / "call-audio-model-eval.json"
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        default=os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"),
    )
    parser.add_argument("--skip-qwen", action="store_true")
    return parser.parse_args()


def prepare_audio_cases(root, output_dir):
    records = []
    for case in CASES:
        audio, sample_rate = read_mono(root / case["source"])
        for variant in case["variants"]:
            variant_audio, variant_sr = make_variant(audio, sample_rate, variant)
            target = output_dir / f"{case['id']}-{variant}.wav"
            sf.write(target, variant_audio, variant_sr, subtype="PCM_16")
            records.append(
                {
                    "id": case["id"],
                    "variant": variant,
                    "language": case["language"],
                    "expected": case["expected"],
                    "source": case["source"],
                    "wav": str(target),
                    "sampleRate": variant_sr,
                    "durationMs": round(len(variant_audio) / variant_sr * 1000),
                }
            )
    return records


def read_mono(path):
    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio, sample_rate


def make_variant(audio, sample_rate, variant):
    if variant == "wideband16k":
        return resample(audio, sample_rate, 16000), 16000
    if variant.startswith("phone8k_up16k"):
        phone = resample(audio, sample_rate, 8000)
        wide = resample(phone, 8000, 16000)
        if variant.endswith("snr15"):
            wide = add_noise(wide, 15)
        return wide, 16000
    raise ValueError(f"unknown audio variant: {variant}")


def resample(audio, source_rate, target_rate):
    if source_rate == target_rate:
        return audio.astype(np.float32, copy=False)
    divisor = math.gcd(source_rate, target_rate)
    return resample_poly(audio, target_rate // divisor, source_rate // divisor).astype(np.float32)


def add_noise(audio, snr_db):
    rng = np.random.default_rng(20260704)
    signal_power = float(np.mean(audio ** 2)) or 1e-8
    noise_power = signal_power / (10 ** (snr_db / 10))
    noise = rng.normal(0, math.sqrt(noise_power), size=audio.shape).astype(np.float32)
    mixed = audio + noise
    peak = float(np.max(np.abs(mixed))) or 1.0
    return (mixed / max(1.0, peak)).astype(np.float32)


def run_firered(root, audio_cases):
    import fireredasr.models.fireredasr as firered_module
    from fireredasr.models.fireredasr import FireRedAsr
    from fireredasr.models.fireredasr_aed import FireRedAsrAed

    model_dir = root / "models" / "fireredasr2_aed"
    firered_module.snapshot_download = lambda _: str(model_dir)

    def load_aed_model(model_path):
        package = torch.load(
            model_path,
            map_location=lambda storage, loc: storage,
            weights_only=False,
        )
        model = FireRedAsrAed.from_args(package["args"])
        missing, unexpected = model.load_state_dict(
            package["model_state_dict"],
            strict=False,
        )
        load_aed_model.missing = list(missing)
        load_aed_model.unexpected = list(unexpected)
        return model

    firered_module.load_fireredasr_aed_model = load_aed_model
    asr = FireRedAsr.from_pretrained("aed")
    batch_ids = [f"{item['id']}:{item['variant']}" for item in audio_cases]
    wavs = [item["wav"] for item in audio_cases]
    start = time.perf_counter()
    raw = asr.transcribe(batch_ids, wavs, {"use_gpu": True, "beam_size": 1})
    total_ms = round((time.perf_counter() - start) * 1000)
    by_id = dict(zip(batch_ids, audio_cases))
    return {
        "status": "ok",
        "model": "FireRedASR2-AED",
        "latencyMs": total_ms,
        "load": {
            "missingKeys": getattr(load_aed_model, "missing", []),
            "unexpectedKeys": getattr(load_aed_model, "unexpected", []),
        },
        "results": [score_asr_result(item, by_id[item["uttid"]], item["text"]) for item in raw],
    }


def run_qwen(root, audio_cases):
    from qwen_asr import Qwen3ASRModel

    model_dir = root / "models" / "qwen3_asr_0_6b"
    model = Qwen3ASRModel.from_pretrained(
        str(model_dir),
        dtype=torch.bfloat16,
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=256,
    )
    results = []
    for item in audio_cases:
        sample_id = f"{item['id']}:{item['variant']}"
        if sample_id not in QWEN_SAMPLE_IDS:
            continue
        start = time.perf_counter()
        raw = model.transcribe(audio=item["wav"], language=item["language"])
        latency_ms = round((time.perf_counter() - start) * 1000)
        first = raw[0]
        text = getattr(first, "text", "")
        language = getattr(first, "language", item["language"])
        scored = score_asr_result({"uttid": sample_id, "language": language}, item, text)
        scored["latencyMs"] = latency_ms
        results.append(scored)
    return {
        "status": "ok",
        "model": "Qwen3-ASR-0.6B",
        "results": results,
    }


def score_asr_result(raw, audio_case, text):
    language = audio_case["language"]
    metric_name = "wer" if language == "English" else "cer"
    error_rate = error_rate_for(language, audio_case["expected"], text)
    return {
        "uttid": raw["uttid"],
        "language": raw.get("language", language),
        "variant": audio_case["variant"],
        "expected": audio_case["expected"],
        "text": text,
        "wav": audio_case["wav"],
        "durationMs": audio_case["durationMs"],
        metric_name: error_rate,
        "passed": error_rate <= (0.3 if language == "English" else 0.18),
    }


def error_rate_for(language, expected, actual):
    if language == "English":
        return round(edit_distance(words(expected), words(actual)) / max(1, len(words(expected))), 4)
    return round(edit_distance(chars(expected), chars(actual)) / max(1, len(chars(expected))), 4)


def words(text):
    return re.findall(r"[a-z0-9']+", text.lower())


def chars(text):
    return list(re.sub(r"[\s，。,.!?！？、]", "", text.lower()))


def edit_distance(left, right):
    previous = list(range(len(right) + 1))
    for i, left_item in enumerate(left, 1):
        current = [i]
        for j, right_item in enumerate(right, 1):
            cost = 0 if left_item == right_item else 1
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost))
        previous = current
    return previous[-1]


def summarize(*sections):
    rows = []
    for section in sections:
        if not section:
            continue
        model = section.get("model", "unknown")
        results = section.get("results", [])
        rows.append(
            {
                "model": model,
                "total": len(results),
                "passed": sum(1 for item in results if item.get("passed")),
                "failed": sum(1 for item in results if not item.get("passed")),
            }
        )
    return rows


if __name__ == "__main__":
    main()
