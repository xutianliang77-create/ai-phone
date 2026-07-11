#!/usr/bin/env python3
import json
import math
import os
import re
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
import torchaudio
from scipy.signal import resample_poly


CASES = [
    {
        "id": "zh_short_stream_s1",
        "kind": "zero_shot",
        "text": "今天下午三点开会。",
        "expected": "今天下午三点开会",
        "language": "Chinese",
        "stream": True,
        "speed": 1.0,
    },
    {
        "id": "zh_short_nonstream_s1",
        "kind": "zero_shot",
        "text": "今天下午三点开会。",
        "expected": "今天下午三点开会",
        "language": "Chinese",
        "stream": False,
        "speed": 1.0,
    },
    {
        "id": "zh_short_stream_s13",
        "kind": "zero_shot",
        "text": "今天下午三点开会。",
        "expected": "今天下午三点开会",
        "language": "Chinese",
        "stream": True,
        "speed": 1.3,
    },
    {
        "id": "zh_meeting_stream_s13",
        "kind": "zero_shot",
        "text": "今天下午三点我们在会议室讨论产品计划。",
        "expected": "今天下午三点我们在会议室讨论产品计划",
        "language": "Chinese",
        "stream": True,
        "speed": 1.3,
    },
    {
        "id": "en_short_stream_s1",
        "kind": "cross_lingual",
        "text": "<|en|>This is a test.",
        "expected": "This is a test",
        "language": "English",
        "stream": True,
        "speed": 1.0,
    },
    {
        "id": "en_short_nonstream_s1",
        "kind": "cross_lingual",
        "text": "<|en|>This is a test.",
        "expected": "This is a test",
        "language": "English",
        "stream": False,
        "speed": 1.0,
    },
]


def main():
    root = Path(os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"))
    out_dir = root / "outputs" / "cosyvoice2-intelligibility"
    out_dir.mkdir(parents=True, exist_ok=True)
    patch_runtime_audio_io()

    from cosyvoice.cli.cosyvoice import AutoModel

    model = AutoModel(
        model_dir=str(root / "models" / "cosyvoice2_0_5b"),
        load_jit=False,
        load_trt=False,
        load_vllm=False,
        fp16=False,
    )
    generated = [generate_case(root, out_dir, model, item) for item in CASES]
    qwen_results = run_qwen_asr(root, generated)
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model": "CosyVoice2-0.5B",
        "results": qwen_results,
        "summary": {
            "total": len(qwen_results),
            "passed": sum(1 for item in qwen_results if item["passed"]),
            "failed": sum(1 for item in qwen_results if not item["passed"]),
        },
    }
    output_path = root / "outputs" / "cosyvoice2-intelligibility-eval.json"
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def patch_runtime_audio_io():
    real_session = ort.InferenceSession

    def safe_session(path_or_bytes, sess_options=None, providers=None, *args, **kwargs):
        available = set(ort.get_available_providers())
        if providers:
            providers = [p for p in providers if p in available] or ["CPUExecutionProvider"]
        return real_session(path_or_bytes, sess_options=sess_options, providers=providers, *args, **kwargs)

    ort.InferenceSession = safe_session

    def safe_load_wav(wav, target_sr):
        data, sr = sf.read(str(wav), dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        speech = torch.from_numpy(np.ascontiguousarray(data)).unsqueeze(0)
        if sr != target_sr:
            speech = torchaudio.functional.resample(speech, sr, target_sr)
        return speech

    import cosyvoice.cli.frontend as frontend_mod
    import cosyvoice.utils.file_utils as file_utils

    file_utils.load_wav = safe_load_wav
    frontend_mod.load_wav = safe_load_wav


def generate_case(root, out_dir, model, item):
    prompt_wav = root / "runtime" / "CosyVoice" / "asset" / "zero_shot_prompt.wav"
    prompt_text = "希望你以后能够做的比我还好呦。"
    start = time.perf_counter()
    chunks = []
    if item["kind"] == "zero_shot":
        iterator = model.inference_zero_shot(
            item["text"],
            prompt_text,
            str(prompt_wav),
            stream=item["stream"],
            speed=item["speed"],
        )
    else:
        iterator = model.inference_cross_lingual(
            item["text"],
            str(prompt_wav),
            stream=item["stream"],
            speed=item["speed"],
        )
    first_audio_ms = None
    for output in iterator:
        speech = output["tts_speech"].detach().cpu()
        if first_audio_ms is None:
            first_audio_ms = round((time.perf_counter() - start) * 1000)
        chunks.append(speech)
    audio = torch.cat(chunks, dim=1).squeeze(0).numpy()
    wav = out_dir / f"{item['id']}.wav"
    sf.write(wav, audio, model.sample_rate, subtype="PCM_16")
    asr_wav = out_dir / f"{item['id']}-16k.wav"
    sf.write(asr_wav, resample(audio, model.sample_rate, 16000), 16000, subtype="PCM_16")
    return {
        **item,
        "wav": str(wav),
        "asrWav": str(asr_wav),
        "firstAudioMs": first_audio_ms,
        "generationMs": round((time.perf_counter() - start) * 1000),
        "audioDurationMs": round(len(audio) / model.sample_rate * 1000),
    }


def run_qwen_asr(root, generated):
    from qwen_asr import Qwen3ASRModel

    model = Qwen3ASRModel.from_pretrained(
        str(root / "models" / "qwen3_asr_0_6b"),
        dtype=torch.bfloat16,
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=128,
    )
    records = []
    for item in generated:
        start = time.perf_counter()
        raw = model.transcribe(audio=item["asrWav"], language=item["language"])
        latency_ms = round((time.perf_counter() - start) * 1000)
        text = getattr(raw[0], "text", "")
        metric = "wer" if item["language"] == "English" else "cer"
        error = error_rate(item["language"], item["expected"], text)
        records.append({
            **item,
            "asrText": text,
            "asrLatencyMs": latency_ms,
            metric: error,
            "passed": error <= (0.3 if item["language"] == "English" else 0.18),
        })
    return records


def resample(audio, source_rate, target_rate):
    divisor = math.gcd(source_rate, target_rate)
    return resample_poly(audio, target_rate // divisor, source_rate // divisor).astype(np.float32)


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
