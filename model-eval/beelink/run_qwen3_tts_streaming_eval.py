#!/usr/bin/env python3
import json
import os
import time
from pathlib import Path

import soundfile as sf
import torch


CASES = [
    {
        "id": "zh_meeting",
        "text": "今天下午三点我们在会议室讨论产品计划。",
        "language": "Chinese",
        "speaker": "Vivian",
    },
    {
        "id": "en_short",
        "text": "This is a realtime translation test. Please speak clearly.",
        "language": "English",
        "speaker": "Ryan",
    },
]


def main():
    root = Path(os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"))
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    out_dir = root / "outputs" / "qwen3-tts-streaming-eval"
    out_dir.mkdir(parents=True, exist_ok=True)

    from qwen_tts import Qwen3TTSModel

    load_start = time.perf_counter()
    model = Qwen3TTSModel.from_pretrained(
        str(root / "models" / "qwen3_tts_0_6b_customvoice"),
        dtype=torch.bfloat16,
        device_map="cuda:0",
    )
    load_ms = elapsed_ms(load_start)

    results = []
    for item in CASES:
        for non_streaming_mode in (True, False):
            results.append(run_case(model, out_dir, item, non_streaming_mode))

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model": "Qwen3-TTS-12Hz-0.6B-CustomVoice",
        "runtime": "qwen-tts 0.1.1",
        "loadMs": load_ms,
        "streamingApi": {
            "publicChunkedAudio": False,
            "parameter": "non_streaming_mode=False",
            "note": "The public qwen-tts Python API returns full wavs, sr. non_streaming_mode=False simulates streaming text input but does not expose audio chunks or callbacks.",
        },
        "results": results,
        "summary": summarize(results),
    }
    output_path = root / "outputs" / "qwen3-tts-streaming-eval.json"
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def run_case(model, out_dir, item, non_streaming_mode):
    start = time.perf_counter()
    wavs, sample_rate = model.generate_custom_voice(
        text=item["text"],
        language=item["language"],
        speaker=item["speaker"],
        non_streaming_mode=non_streaming_mode,
    )
    generation_ms = elapsed_ms(start)
    audio = wavs[0]
    audio_duration_ms = round(len(audio) / sample_rate * 1000)
    mode = "non_streaming" if non_streaming_mode else "simulated_streaming"
    output = out_dir / f"{item['id']}-{mode}.wav"
    sf.write(output, audio, sample_rate, subtype="PCM_16")
    return {
        "id": item["id"],
        "text": item["text"],
        "language": item["language"],
        "speaker": item["speaker"],
        "mode": mode,
        "nonStreamingMode": non_streaming_mode,
        "returnedAudioMs": generation_ms,
        "generationMs": generation_ms,
        "audioDurationMs": audio_duration_ms,
        "rtf": round(generation_ms / max(1, audio_duration_ms), 3),
        "sampleRate": sample_rate,
        "output": str(output),
    }


def summarize(results):
    by_id = {}
    for item in results:
        by_id.setdefault(item["id"], []).append(item)
    rows = []
    for case_id, items in by_id.items():
        non_streaming = next((x for x in items if x["mode"] == "non_streaming"), None)
        simulated = next((x for x in items if x["mode"] == "simulated_streaming"), None)
        rows.append(
            {
                "id": case_id,
                "nonStreamingReturnedAudioMs": non_streaming["returnedAudioMs"] if non_streaming else None,
                "simulatedStreamingReturnedAudioMs": simulated["returnedAudioMs"] if simulated else None,
                "deltaMs": (
                    simulated["returnedAudioMs"] - non_streaming["returnedAudioMs"]
                    if non_streaming and simulated
                    else None
                ),
            }
        )
    return rows


def elapsed_ms(start):
    return round((time.perf_counter() - start) * 1000)


if __name__ == "__main__":
    main()
