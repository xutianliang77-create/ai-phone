#!/usr/bin/env python3
import json
import os
import re
import time
from pathlib import Path

import torch


CASES = [
    {
        "id": "zh_meeting-simulated_streaming",
        "language": "Chinese",
        "expected": "今天下午三点我们在会议室讨论产品计划",
        "wav": "outputs/qwen3-tts-streaming-eval/zh_meeting-simulated_streaming.wav",
    },
    {
        "id": "en_short-simulated_streaming",
        "language": "English",
        "expected": "This is a realtime translation test Please speak clearly",
        "wav": "outputs/qwen3-tts-streaming-eval/en_short-simulated_streaming.wav",
    },
]


def main():
    root = Path(os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"))
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    from qwen_asr import Qwen3ASRModel

    model = Qwen3ASRModel.from_pretrained(
        str(root / "models" / "qwen3_asr_0_6b"),
        dtype=torch.bfloat16,
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=128,
    )
    results = [run_case(root, model, item) for item in CASES]
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "asrProxy": "Qwen3-ASR-0.6B",
        "results": results,
        "summary": {
            "total": len(results),
            "passed": sum(1 for item in results if item["passed"]),
            "failed": sum(1 for item in results if not item["passed"]),
        },
    }
    output = root / "outputs" / "qwen3-tts-streaming-asr-proxy.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def run_case(root, model, item):
    start = time.perf_counter()
    raw = model.transcribe(audio=str(root / item["wav"]), language=item["language"])
    latency_ms = round((time.perf_counter() - start) * 1000)
    text = getattr(raw[0], "text", "")
    metric = "wer" if item["language"] == "English" else "cer"
    error = error_rate(item["language"], item["expected"], text)
    return {
        **item,
        "text": text,
        "latencyMs": latency_ms,
        metric: error,
        "passed": error <= (0.3 if item["language"] == "English" else 0.18),
    }


def error_rate(language, expected, actual):
    left = words(expected) if language == "English" else chars(expected)
    right = words(actual) if language == "English" else chars(actual)
    return round(edit_distance(left, right) / max(1, len(left)), 4)


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


if __name__ == "__main__":
    main()
