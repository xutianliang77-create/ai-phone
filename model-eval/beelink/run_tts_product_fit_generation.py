#!/usr/bin/env python3
import gc
import json
import math
import os
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import soundfile as sf
import torch


CASES = [
    {
        "id": "zh_meeting",
        "language": "Chinese",
        "text": "今天下午三点我们在会议室讨论产品计划。",
        "expected": "今天下午三点我们在会议室讨论产品计划",
    },
    {
        "id": "en_call",
        "language": "English",
        "text": "This is a realtime translation call. Please speak clearly.",
        "expected": "This is a realtime translation call Please speak clearly",
    },
    {
        "id": "zh_terms",
        "language": "Chinese",
        "text": "报价是两万元，SKU 是 A-120。",
        "expected": "报价是两万元SKU是A一百二十",
    },
]


def main():
    root = Path(os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"))
    data_root = root / "data" / "tts-product-fit"
    out_root = data_root / "outputs"
    out_root.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    available_models = [
        ("qwen3_tts", run_qwen3_tts),
        ("cosyvoice3", run_cosyvoice3),
        ("voxcpm2", run_voxcpm2),
        ("chatterbox_mtl_v3", run_chatterbox),
        ("luxtts", run_luxtts),
    ]
    wanted = set(filter(None, os.environ.get("TTS_PRODUCT_MODELS", "").split(",")))
    models = [item for item in available_models if not wanted or item[0] in wanted]
    output_json = data_root / "tts-product-fit-generation.json"
    payload = load_payload(output_json, root, data_root)
    for model_id, runner in models:
        record = {"id": model_id, "status": "started", "cases": []}
        started = time.perf_counter()
        try:
            record.update(runner(root, data_root, out_root / model_id))
            record["status"] = "ok"
        except Exception as exc:
            record.update(
                {
                    "status": "failed",
                    "error": type(exc).__name__,
                    "message": str(exc),
                    "traceback": traceback.format_exc()[-3000:],
                }
            )
        record["elapsedMs"] = elapsed_ms(started)
        upsert_model(payload, record)
        write_json(output_json, payload)
        free_gpu()
        print(json.dumps(record, ensure_ascii=False), flush=True)
    payload["generatedAt"] = now()
    write_json(output_json, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def run_qwen3_tts(root, _data_root, out_dir):
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained(
        str(root / "models" / "qwen3_tts_0_6b_customvoice"),
        dtype=torch.bfloat16,
        device_map="cuda:0",
    )
    rows = []
    for case in CASES:
        speaker = "Ryan" if case["language"] == "English" else "Vivian"
        start = time.perf_counter()
        wavs, sample_rate = model.generate_custom_voice(
            text=case["text"],
            language=case["language"],
            speaker=speaker,
            non_streaming_mode=False,
        )
        rows.append(save_case(out_dir, case, np.asarray(wavs[0]), sample_rate, start, None))
    return {"repo": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", "streaming": "simulated", "cases": rows}


def run_cosyvoice3(root, data_root, out_dir):
    patch_cosyvoice_runtime(root)
    runtime_root = root / "runtime" / "CosyVoice"
    sys.path.insert(0, str(runtime_root))
    sys.path.insert(0, str(runtime_root / "third_party" / "Matcha-TTS"))
    from cosyvoice.cli.cosyvoice import AutoModel

    model = AutoModel(
        model_dir=str(cosyvoice3_model_dir(data_root)),
        load_trt=False,
        load_vllm=False,
        fp16=False,
    )
    prompt = "You are a helpful assistant.<|endofprompt|>希望你以后能够做的比我还好呦。"
    prompt_wav = runtime_root / "asset" / "zero_shot_prompt.wav"
    rows = []
    for case in CASES:
        start = time.perf_counter()
        chunks = []
        first_ms = None
        for output in model.inference_zero_shot(
            case["text"],
            prompt,
            str(prompt_wav),
            stream=True,
            speed=1.0,
            text_frontend=True,
        ):
            if first_ms is None:
                first_ms = elapsed_ms(start)
            chunks.append(output["tts_speech"].detach().cpu())
        audio = torch.cat(chunks, dim=1).squeeze(0).numpy()
        rows.append(save_case(out_dir, case, audio, model.sample_rate, start, first_ms))
    return {"repo": "FunAudioLLM/Fun-CosyVoice3-0.5B-2512", "streaming": "audio_chunks", "cases": rows}


def run_voxcpm2(_root, data_root, out_dir):
    from voxcpm import VoxCPM

    model = VoxCPM.from_pretrained(str(data_root / "models" / "openbmb_voxcpm2"), load_denoiser=False)
    sample_rate = model.tts_model.sample_rate
    rows = []
    for case in CASES:
        text = case["text"]
        if case["language"] == "Chinese":
            text = "(A clear, warm Mandarin voice for phone translation)" + text
        else:
            text = "(A clear, warm English voice for phone translation)" + text
        start = time.perf_counter()
        chunks = []
        first_ms = None
        if hasattr(model, "generate_streaming"):
            for chunk in model.generate_streaming(text=text, cfg_value=2.0, inference_timesteps=10):
                if first_ms is None:
                    first_ms = elapsed_ms(start)
                chunks.append(np.asarray(chunk))
            audio = np.concatenate(chunks)
        else:
            audio = model.generate(text=text, cfg_value=2.0, inference_timesteps=10)
        rows.append(save_case(out_dir, case, np.asarray(audio), sample_rate, start, first_ms))
    return {"repo": "openbmb/VoxCPM2", "streaming": "audio_chunks_if_available", "cases": rows}


def run_chatterbox(_root, data_root, out_dir):
    os.environ.pop("TRANSFORMERS_OFFLINE", None)
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    model_dir = data_root / "models" / "resembleai_chatterbox"
    model = ChatterboxMultilingualTTS.from_local(model_dir, device="cuda")
    rows = []
    for case in CASES:
        lang = "zh" if case["language"] == "Chinese" else "en"
        start = time.perf_counter()
        wav = model.generate(case["text"], language_id=lang)
        audio = wav.detach().cpu().squeeze().numpy() if hasattr(wav, "detach") else np.asarray(wav)
        rows.append(save_case(out_dir, case, audio, model.sr, start, None))
    return {"repo": "ResembleAI/chatterbox", "streaming": "not_public_in_python_api", "cases": rows}


def run_luxtts(root, data_root, out_dir):
    from zipvoice.luxvoice import LuxTTS

    model_dir = data_root / "models" / "yatharths_luxtts"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = LuxTTS(str(model_dir), device=device)
    prompt_audio = Path(
        os.environ.get(
            "LUXTTS_PROMPT_AUDIO",
            str(root / "runtime" / "CosyVoice" / "asset" / "zero_shot_prompt.wav"),
        )
    )
    encoded_prompt = model.encode_prompt(str(prompt_audio), rms=float(os.environ.get("LUXTTS_RMS", "0.01")))
    sample_rate = int(getattr(model, "sample_rate", 48000))
    rows = []
    for case in CASES:
        start = time.perf_counter()
        audio = model.generate_speech(
            case["text"],
            encoded_prompt,
            num_steps=int(os.environ.get("LUXTTS_NUM_STEPS", "4")),
            speed=float(os.environ.get("LUXTTS_SPEED", "1.0")),
        )
        if isinstance(audio, tuple):
            audio = audio[0]
        if hasattr(audio, "detach"):
            audio = audio.detach().cpu().numpy()
        rows.append(save_case(out_dir, case, np.asarray(audio), sample_rate, start, None))
    return {"repo": "YatharthS/LuxTTS", "streaming": "not_public_in_python_api", "cases": rows}


def patch_cosyvoice_runtime(root):
    import onnxruntime as ort
    import torchaudio

    real_session = ort.InferenceSession

    def safe_session(path_or_bytes, sess_options=None, providers=None, *args, **kwargs):
        available = set(ort.get_available_providers())
        if providers:
            providers = [p for p in providers if p in available] or ["CPUExecutionProvider"]
        return real_session(path_or_bytes, sess_options=sess_options, providers=providers, *args, **kwargs)

    ort.InferenceSession = safe_session
    runtime_root = root / "runtime" / "CosyVoice"
    sys.path.insert(0, str(runtime_root))
    sys.path.insert(0, str(runtime_root / "third_party" / "Matcha-TTS"))
    import cosyvoice.cli.frontend as frontend_mod
    import cosyvoice.utils.file_utils as file_utils

    def safe_load_wav(wav, target_sr):
        data, sr = sf.read(str(wav), dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=1)
        speech = torch.from_numpy(np.ascontiguousarray(data)).unsqueeze(0)
        if sr != target_sr:
            speech = torchaudio.functional.resample(speech, sr, target_sr)
        return speech

    file_utils.load_wav = safe_load_wav
    frontend_mod.load_wav = safe_load_wav


def cosyvoice3_model_dir(data_root):
    candidates = [
        data_root / "models" / "fun_cosyvoice3_0_5b_2512_modelscope",
        data_root / "models" / "fun_cosyvoice3_0_5b_2512",
    ]
    for candidate in candidates:
        if (candidate / "cosyvoice3.yaml").exists():
            return candidate
    return candidates[0]


def save_case(out_dir, case, audio, sample_rate, start, first_audio_ms):
    out_dir.mkdir(parents=True, exist_ok=True)
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    wav_path = out_dir / f"{case['id']}.wav"
    sf.write(wav_path, audio, sample_rate, subtype="PCM_16")
    generation_ms = elapsed_ms(start)
    audio_duration_ms = round(len(audio) / sample_rate * 1000)
    return {
        **case,
        "wav": str(wav_path),
        "sampleRate": sample_rate,
        "generationMs": generation_ms,
        "firstAudioMs": first_audio_ms if first_audio_ms is not None else generation_ms,
        "audioDurationMs": audio_duration_ms,
        "rtf": round(generation_ms / max(1, audio_duration_ms), 3),
    }


def free_gpu():
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def elapsed_ms(start):
    return round((time.perf_counter() - start) * 1000)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def load_payload(path, root, data_root):
    if path.exists():
        try:
            payload = json.loads(path.read_text())
            payload.setdefault("models", [])
            payload["root"] = str(root)
            payload["dataRoot"] = str(data_root)
            payload["cases"] = CASES
            payload["generatedAt"] = now()
            return payload
        except json.JSONDecodeError:
            pass
    return {
        "generatedAt": now(),
        "root": str(root),
        "dataRoot": str(data_root),
        "cases": CASES,
        "models": [],
    }


def upsert_model(payload, record):
    payload["models"] = [model for model in payload["models"] if model.get("id") != record["id"]]
    payload["models"].append(record)


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
