#!/usr/bin/env python3
import json
import os
import time
import traceback
from pathlib import Path


ROOT = Path(os.environ.get("MODEL_EVAL_ROOT", "/data/models/translation-model-eval"))
DATA_ROOT = ROOT / "data" / "tts-product-fit"

TARGETS = {
    "cosyvoice3_ms": {
        "repo": "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
        "source": "modelscope",
        "local": DATA_ROOT / "models" / "fun_cosyvoice3_0_5b_2512_modelscope",
    },
    "cosyvoice3_hf": {
        "repo": "FunAudioLLM/Fun-CosyVoice3-0.5B-2512",
        "source": "huggingface",
        "local": DATA_ROOT / "models" / "fun_cosyvoice3_0_5b_2512",
    },
    "voxcpm2": {
        "repo": "openbmb/VoxCPM2",
        "source": "huggingface",
        "local": DATA_ROOT / "models" / "openbmb_voxcpm2",
    },
    "voxcpm2_weight": {
        "repo": "openbmb/VoxCPM2",
        "source": "huggingface_files",
        "files": ["model.safetensors"],
        "local": DATA_ROOT / "models" / "openbmb_voxcpm2",
    },
    "chatterbox": {
        "repo": "ResembleAI/chatterbox",
        "source": "huggingface",
        "local": DATA_ROOT / "models" / "resembleai_chatterbox",
    },
    "chatterbox_weights": {
        "repo": "ResembleAI/chatterbox",
        "source": "huggingface_files",
        "files": ["ve.pt", "t3_mtl23ls_v2.safetensors", "s3gen.pt"],
        "local": DATA_ROOT / "models" / "resembleai_chatterbox",
    },
    "fish_s2_pro": {
        "repo": "fishaudio/s2-pro",
        "source": "huggingface",
        "local": DATA_ROOT / "models" / "fishaudio_s2_pro",
    },
    "luxtts": {
        "repo": "YatharthS/LuxTTS",
        "source": "huggingface",
        "local": DATA_ROOT / "models" / "yatharths_luxtts",
    },
}


def main():
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "0")
    os.environ.setdefault("HF_HUB_ETAG_TIMEOUT", "60")
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")
    selected = os.environ.get("TTS_DOWNLOAD_MODELS", "cosyvoice3_ms,voxcpm2,chatterbox,luxtts")
    names = [item.strip() for item in selected.split(",") if item.strip()]
    for name in names:
        if name not in TARGETS:
            raise ValueError(f"unknown target: {name}")
        download(name, TARGETS[name])


def download(name, target):
    target["local"].mkdir(parents=True, exist_ok=True)
    status = {
        "name": name,
        "repo": target["repo"],
        "source": target["source"],
        "localDir": str(target["local"]),
        "startedAt": now(),
        "status": "started",
    }
    status_path = DATA_ROOT / f"download-{name}-status.json"
    write_json(status_path, status)
    started = time.perf_counter()
    try:
        if target["source"] == "modelscope":
            from modelscope import snapshot_download

            path = snapshot_download(target["repo"], local_dir=str(target["local"]))
        elif target["source"] == "huggingface_files":
            from huggingface_hub import hf_hub_download

            path = str(target["local"])
            for filename in target["files"]:
                hf_hub_download(
                    repo_id=target["repo"],
                    filename=filename,
                    local_dir=str(target["local"]),
                    resume_download=True,
                )
        else:
            from huggingface_hub import snapshot_download

            path = snapshot_download(
                repo_id=target["repo"],
                local_dir=str(target["local"]),
                resume_download=True,
                max_workers=int(os.environ.get("TTS_DOWNLOAD_WORKERS", "2")),
            )
        status.update({"status": "complete", "path": path})
    except Exception as exc:
        status.update(
            {
                "status": "failed",
                "error": type(exc).__name__,
                "message": str(exc),
                "traceback": traceback.format_exc()[-3000:],
            }
        )
    status["finishedAt"] = now()
    status["elapsedSeconds"] = round(time.perf_counter() - started, 1)
    write_json(status_path, status)
    print(json.dumps(status, ensure_ascii=False), flush=True)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def write_json(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
