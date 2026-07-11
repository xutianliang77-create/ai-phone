#!/usr/bin/env python3
import gc
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
import torchaudio
from scipy.signal import resample_poly


ZH_OFFICIAL = "收到好友从远方寄来的生日礼物，那份意外的惊喜与深深的祝福让我心中充满了甜蜜的快乐，笑容如花儿般绽放。"
ZH_OFFICIAL_EXPECTED = "收到好友从远方寄来的生日礼物那份意外的惊喜与深深的祝福让我心中充满了甜蜜的快乐笑容如花儿般绽放"
ZH_MEETING = "今天下午三点我们在会议室讨论产品计划。"
ZH_MEETING_EXPECTED = "今天下午三点我们在会议室讨论产品计划"
EN_SHORT = "<|en|>This is a realtime translation test. Please speak clearly."
EN_SHORT_EXPECTED = "This is a realtime translation test Please speak clearly"

CASES = [
    {
        "id": "zh_meeting_zero_stream",
        "kind": "zero_shot",
        "text": ZH_MEETING,
        "expected": ZH_MEETING_EXPECTED,
        "language": "Chinese",
        "promptText": "希望你以后能够做的比我还好呦。",
        "promptWav": "zero_shot_prompt.wav",
        "stream": True,
        "speed": 1.0,
        "textFrontend": True,
    },
    {
        "id": "zh_meeting_zero_nonstream",
        "kind": "zero_shot",
        "text": ZH_MEETING,
        "expected": ZH_MEETING_EXPECTED,
        "language": "Chinese",
        "promptText": "希望你以后能够做的比我还好呦。",
        "promptWav": "zero_shot_prompt.wav",
        "stream": False,
        "speed": 1.0,
        "textFrontend": True,
    },
    {
        "id": "zh_official_zero_stream",
        "kind": "zero_shot",
        "text": ZH_OFFICIAL,
        "expected": ZH_OFFICIAL_EXPECTED,
        "language": "Chinese",
        "promptText": "希望你以后能够做的比我还好呦。",
        "promptWav": "zero_shot_prompt.wav",
        "stream": True,
        "speed": 1.0,
        "textFrontend": True,
    },
    {
        "id": "zh_official_zero_no_frontend",
        "kind": "zero_shot",
        "text": ZH_OFFICIAL,
        "expected": ZH_OFFICIAL_EXPECTED,
        "language": "Chinese",
        "promptText": "希望你以后能够做的比我还好呦。",
        "promptWav": "zero_shot_prompt.wav",
        "stream": False,
        "speed": 1.0,
        "textFrontend": False,
    },
    {
        "id": "en_cross_zero_prompt",
        "kind": "cross_lingual",
        "text": EN_SHORT,
        "expected": EN_SHORT_EXPECTED,
        "language": "English",
        "promptWav": "zero_shot_prompt.wav",
        "stream": True,
        "speed": 1.0,
        "textFrontend": True,
    },
    {
        "id": "en_cross_cross_prompt",
        "kind": "cross_lingual",
        "text": EN_SHORT,
        "expected": EN_SHORT_EXPECTED,
        "language": "English",
        "promptWav": "cross_lingual_prompt.wav",
        "stream": True,
        "speed": 1.0,
        "textFrontend": True,
    },
]


def main():
    root = Path(os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"))
    runtime_root = root / "runtime" / "CosyVoice"
    sys.path.insert(0, str(runtime_root))
    sys.path.insert(0, str(runtime_root / "third_party" / "Matcha-TTS"))
    out_dir = root / "outputs" / "cosyvoice2-prompt-diagnostic"
    out_dir.mkdir(parents=True, exist_ok=True)
    patch_runtime_audio_io()

    from cosyvoice.cli.cosyvoice import AutoModel

    load_start = time.perf_counter()
    model = AutoModel(
        model_dir=str(root / "models" / "cosyvoice2_0_5b"),
        load_jit=False,
        load_trt=False,
        load_vllm=False,
        fp16=False,
    )
    load_ms = elapsed_ms(load_start)
    generated = [generate_case(root, out_dir, model, item) for item in CASES]
    del model
    gc.collect()
    torch.cuda.empty_cache()

    asr_results = run_qwen_asr(root, generated)
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model": "CosyVoice2-0.5B",
        "loadMs": load_ms,
        "results": asr_results,
        "summary": {
            "total": len(asr_results),
            "passed": sum(1 for item in asr_results if item["passed"]),
            "failed": sum(1 for item in asr_results if not item["passed"]),
        },
    }
    output = root / "outputs" / "cosyvoice2-prompt-diagnostic.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
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
    prompt_wav = root / "runtime" / "CosyVoice" / "asset" / item["promptWav"]
    start = time.perf_counter()
    chunks = []
    if item["kind"] == "zero_shot":
        iterator = model.inference_zero_shot(
            item["text"],
            item["promptText"],
            str(prompt_wav),
            stream=item["stream"],
            speed=item["speed"],
            text_frontend=item["textFrontend"],
        )
    else:
        iterator = model.inference_cross_lingual(
            item["text"],
            str(prompt_wav),
            stream=item["stream"],
            speed=item["speed"],
            text_frontend=item["textFrontend"],
        )
    first_audio_ms = None
    for output in iterator:
        speech = output["tts_speech"].detach().cpu()
        if first_audio_ms is None:
            first_audio_ms = elapsed_ms(start)
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
        "generationMs": elapsed_ms(start),
        "audioDurationMs": round(len(audio) / model.sample_rate * 1000),
    }


def run_qwen_asr(root, generated):
    from qwen_asr import Qwen3ASRModel

    model = Qwen3ASRModel.from_pretrained(
        str(root / "models" / "qwen3_asr_0_6b"),
        dtype=torch.bfloat16,
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=160,
    )
    records = []
    for item in generated:
        start = time.perf_counter()
        raw = model.transcribe(audio=item["asrWav"], language=item["language"])
        text = getattr(raw[0], "text", "")
        metric = "wer" if item["language"] == "English" else "cer"
        error = error_rate(item["language"], item["expected"], text)
        records.append(
            {
                **item,
                "asrText": text,
                "asrLatencyMs": elapsed_ms(start),
                metric: error,
                "passed": error <= (0.3 if item["language"] == "English" else 0.18),
            }
        )
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


def elapsed_ms(start):
    return round((time.perf_counter() - start) * 1000)


if __name__ == "__main__":
    main()
