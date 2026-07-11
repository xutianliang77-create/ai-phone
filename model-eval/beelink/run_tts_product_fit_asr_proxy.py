#!/usr/bin/env python3
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


VARIANTS = ["wideband16k", "phone8k_up16k", "phone8k_up16k_snr15"]


def main():
    root = Path(os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"))
    data_root = root / "data" / "tts-product-fit"
    source = json.loads((data_root / "tts-product-fit-generation.json").read_text())
    prepared = prepare_audio(data_root, source)
    results = run_qwen_asr(root, prepared)
    payload = {
        "generatedAt": now(),
        "source": str(data_root / "tts-product-fit-generation.json"),
        "asrProxy": "Qwen3-ASR-0.6B",
        "results": results,
        "summary": summarize(results),
    }
    (data_root / "tts-product-fit-asr-proxy.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def prepare_audio(data_root, source):
    out_dir = data_root / "outputs" / "asr-proxy-audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for model in source["models"]:
        if model.get("status") != "ok":
            continue
        for case in model.get("cases", []):
            audio, sample_rate = read_mono(case["wav"])
            for variant in VARIANTS:
                variant_audio, variant_sr = make_variant(audio, sample_rate, variant)
                wav = out_dir / f"{model['id']}-{case['id']}-{variant}.wav"
                sf.write(wav, variant_audio, variant_sr, subtype="PCM_16")
                records.append(
                    {
                        "modelId": model["id"],
                        "caseId": case["id"],
                        "language": case["language"],
                        "expected": case["expected"],
                        "variant": variant,
                        "sourceWav": case["wav"],
                        "wav": str(wav),
                        "sampleRate": variant_sr,
                        "durationMs": round(len(variant_audio) / variant_sr * 1000),
                        "generationMs": case["generationMs"],
                        "firstAudioMs": case["firstAudioMs"],
                        "ttsRtf": case["rtf"],
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
    raise ValueError(f"unknown variant: {variant}")


def resample(audio, source_rate, target_rate):
    if source_rate == target_rate:
        return audio.astype(np.float32, copy=False)
    divisor = math.gcd(source_rate, target_rate)
    return resample_poly(audio, target_rate // divisor, source_rate // divisor).astype(np.float32)


def add_noise(audio, snr_db):
    rng = np.random.default_rng(20260704)
    signal_power = float(np.mean(audio**2)) or 1e-8
    noise_power = signal_power / (10 ** (snr_db / 10))
    noise = rng.normal(0, math.sqrt(noise_power), size=audio.shape).astype(np.float32)
    mixed = audio + noise
    peak = float(np.max(np.abs(mixed))) or 1.0
    return (mixed / max(1.0, peak)).astype(np.float32)


def run_qwen_asr(root, records):
    from qwen_asr import Qwen3ASRModel

    model = Qwen3ASRModel.from_pretrained(
        str(root / "models" / "qwen3_asr_0_6b"),
        dtype=torch.bfloat16,
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=160,
    )
    scored = []
    for item in records:
        started = time.perf_counter()
        raw = model.transcribe(audio=item["wav"], language=item["language"])
        text = getattr(raw[0], "text", "")
        metric_name = "wer" if item["language"] == "English" else "cer"
        error = error_rate(item["language"], item["expected"], text)
        scored.append(
            {
                **item,
                "text": text,
                "asrLatencyMs": elapsed_ms(started),
                metric_name: error,
                "passed": error <= (0.3 if item["language"] == "English" else 0.18),
            }
        )
    return scored


def summarize(results):
    by_model = {}
    for item in results:
        bucket = by_model.setdefault(item["modelId"], {"total": 0, "passed": 0, "variants": {}})
        bucket["total"] += 1
        bucket["passed"] += 1 if item["passed"] else 0
        variant = bucket["variants"].setdefault(item["variant"], {"total": 0, "passed": 0})
        variant["total"] += 1
        variant["passed"] += 1 if item["passed"] else 0
    ranking = []
    for model_id, row in by_model.items():
        total = row["total"]
        wide = row["variants"].get("wideband16k", {"passed": 0, "total": 0})
        phone = row["variants"].get("phone8k_up16k", {"passed": 0, "total": 0})
        noisy = row["variants"].get("phone8k_up16k_snr15", {"passed": 0, "total": 0})
        ranking.append(
            {
                "modelId": model_id,
                "passed": row["passed"],
                "total": total,
                "passRate": round(row["passed"] / max(1, total), 4),
                "widebandPassRate": pass_rate(wide),
                "phonePassRate": pass_rate(phone),
                "noisyPhonePassRate": pass_rate(noisy),
            }
        )
    ranking.sort(key=lambda item: (item["passRate"], item["phonePassRate"]), reverse=True)
    return {
        "total": len(results),
        "passed": sum(1 for item in results if item["passed"]),
        "failed": sum(1 for item in results if not item["passed"]),
        "ranking": ranking,
    }


def pass_rate(row):
    return round(row["passed"] / max(1, row["total"]), 4)


def error_rate(language, expected, actual):
    left = words(expected) if language == "English" else chars(expected)
    right = words(actual) if language == "English" else chars(actual)
    return round(edit_distance(left, right) / max(1, len(left)), 4)


def words(text):
    return re.findall(r"[a-z0-9']+", text.lower())


def chars(text):
    return list(re.sub(r"[\s，。,.!?！？、\\-]", "", text.lower()))


def edit_distance(left, right):
    previous = list(range(len(right) + 1))
    for i, left_item in enumerate(left, 1):
        current = [i]
        for j, right_item in enumerate(right, 1):
            cost = 0 if left_item == right_item else 1
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost))
        previous = current
    return previous[-1]


def elapsed_ms(start):
    return round((time.perf_counter() - start) * 1000)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


if __name__ == "__main__":
    main()
