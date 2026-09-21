"""Bounded offline comparison; imports unmodified frozen 1.0 speaker code.

No HTTP service, GPU, identity database, credentials or network model download.
Run in the existing speaker venv with a preserved source/model and PCM manifest.
"""
import argparse
import asyncio
import base64
import hashlib
import json
import os
import sys
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--preservation", required=True)
parser.add_argument("--inputs", required=True)
parser.add_argument("--source-manifest", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
preserved, inputs = Path(args.preservation), Path(args.inputs)
os.environ.update(CUDA_VISIBLE_DEVICES="", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", PYTHONDONTWRITEBYTECODE="1")
source = preserved / "source-speaker"
for entry in json.loads(Path(args.source_manifest).read_text())["entries"]:
    if entry.get("kind") != "file" or not entry["path"].startswith("app/"):
        continue
    if hashlib.sha256((source / entry["path"]).read_bytes()).hexdigest() != entry["sha256"]:
        raise RuntimeError("Frozen 1.0 speaker source changed")
model = preserved / "model-speaker/diar_streaming_sortformer_4spk-v2.1.nemo"
if hashlib.sha256(model.read_bytes()).hexdigest() != "8abd32832159c6ac1148c926b7276f35ba34582c444e559dce1f1253fea42ef8":
    raise RuntimeError("Frozen 1.0 speaker weights changed")
allowed = {"SPEAKER_CHUNK_LEN", "SPEAKER_CHUNK_LEFT_CONTEXT", "SPEAKER_CHUNK_RIGHT_CONTEXT", "SPEAKER_FIFO_LEN",
           "SPEAKER_CACHE_UPDATE_PERIOD", "SPEAKER_CACHE_LEN", "SPEAKER_ONSET", "SPEAKER_OFFSET", "SPEAKER_PAD_OFFSET_MS",
           "SPEAKER_MIN_DURATION_ON_MS", "SPEAKER_MIN_DURATION_OFF_MS"}
for line in (preserved / "config-speaker/wujie-v1-speaker-cpu.env").read_text().splitlines():
    key, _, value = line.partition("=")
    if key in allowed:
        os.environ[key] = value.strip().strip("\"'")
sys.path.insert(0, str(source))
import torch
torch.set_num_threads(4)
from app.config import load_config
from app.schemas import CreateSpeakerSessionRequest, SpeakerAudioFrame
from app.sortformer_shadow_engine import SortformerShadowEngine
from app.sortformer_streaming_runtime import StreamingProfile

async def run():
    config = load_config()
    profile = StreamingProfile(chunk_len=config.chunk_len, chunk_left_context=config.chunk_left_context,
        chunk_right_context=config.chunk_right_context, fifo_len=config.fifo_len,
        spkcache_update_period=config.spkcache_update_period, spkcache_len=config.spkcache_len)
    engine = SortformerShadowEngine(str(model), profile, config.onset, config.offset, device="cpu",
        pad_offset_ms=config.pad_offset_ms, min_duration_on_ms=config.min_duration_on_ms,
        min_duration_off_ms=config.min_duration_off_ms)
    results = {"status": "running", "arm": "frozen_1.0_cpu", "modelSha256": hashlib.sha256(model.read_bytes()).hexdigest(),
        "profile": {k: os.environ.get(k) for k in sorted(allowed)}, "networkCalls": 0, "cases": []}
    manifest = json.loads((inputs / "manifest.json").read_text())
    for item in manifest["cases"]:
        rate = item["sampleRate"]
        pcm = (inputs / (item["id"] + ".pcm")).read_bytes()
        if rate not in (16000, 24000) or hashlib.sha256(pcm).hexdigest() != item["sha256"] or len(pcm) > rate * 2 * 300:
            raise RuntimeError("Input mismatch or unbounded fixture")
        name = item["id"]
        await engine.create_session(CreateSpeakerSessionRequest(sessionId=name, options={"mode": "diarization", "maxSpeakers": 4, "allowVoiceIdentity": False}))
        spans, started = [], time.monotonic()
        chunk_bytes = rate * 2 * 80 // 1000
        for index, offset in enumerate(range(0, len(pcm), chunk_bytes)):
            frame = SpeakerAudioFrame(type="audio.frame", sessionId=name, sequence=index+1, timestampMs=offset*1000//(rate*2),
                format="pcm16", sampleRate=rate, data=base64.b64encode(pcm[offset:offset+chunk_bytes]).decode())
            spans.extend(span.model_dump() for span in await engine.push_audio(frame))
        spans.extend(span.model_dump() for span in await engine.flush(name))
        await engine.close_session(name)
        results["cases"].append({"id": name, "sha256": item["sha256"], "inputSamples": len(pcm)//2,
            "wallMs": (time.monotonic()-started)*1000, "spans": spans})
        Path(args.output).write_text(json.dumps(results, indent=2))
        print(json.dumps({"case": name, "spans": len(spans)}), flush=True)
    results["status"] = "completed"
    Path(args.output).write_text(json.dumps(results, indent=2))

asyncio.run(run())
