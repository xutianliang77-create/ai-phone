#!/usr/bin/env python3
"""Probe cold/warm TTS latency and fail closed when release gates are exceeded."""

import argparse
import json
import math
import os
import statistics
import time
from urllib.request import Request, urlopen


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument(
        "--api-key",
        default=os.getenv("TTS_HTTP_API_KEY") or os.getenv("TTS_SERVICE_API_KEY", ""),
    )
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--cold-max-ms", type=int, default=15000)
    parser.add_argument("--warm-p95-max-ms", type=int, default=2500)
    parser.add_argument("--first-audio-p95-max-ms", type=int, default=2000)
    args = parser.parse_args()
    if args.samples < 3:
        parser.error("--samples must be at least 3")

    warmup = post_json(
        f"{args.base_url.rstrip('/')}/tts/warmup",
        request_payload("tts-warmup", "准备就绪"),
        args.api_key,
    )
    wall_times: list[int] = []
    first_audio: list[int] = []
    stream_wall_times: list[int] = []
    stream_model_first_audio: list[int] = []
    stream_first_audio: list[int] = []
    for index in range(args.samples):
        started = time.perf_counter()
        result = post_json(
            f"{args.base_url.rstrip('/')}/tts/synthesize",
            request_payload(f"tts-gate-{index + 1}", sample_text(index)),
            args.api_key,
        )
        wall_times.append(round((time.perf_counter() - started) * 1000))
        first_audio.append(int(result["firstAudioMs"]))
        stream = post_stream(
            f"{args.base_url.rstrip('/')}/tts/stream",
            request_payload(f"tts-stream-gate-{index + 1}", sample_text(index)),
            args.api_key,
        )
        stream_wall_times.append(stream["wallMs"])
        stream_model_first_audio.append(stream["modelFirstAudioMs"])
        stream_first_audio.append(stream["firstAudioMs"])

    metrics = {
        "warmupElapsedMs": int(warmup["elapsedMs"]),
        "warmupCached": bool(warmup["cached"]),
        "samples": args.samples,
        "wallMs": summary(wall_times),
        "firstAudioMs": summary(first_audio),
        "streamWallMs": summary(stream_wall_times),
        "streamModelFirstAudioMs": summary(stream_model_first_audio),
        "streamFirstAudioMs": summary(stream_first_audio),
        "thresholds": {
            "coldMaxMs": args.cold_max_ms,
            "warmP95MaxMs": args.warm_p95_max_ms,
            "firstAudioP95MaxMs": args.first_audio_p95_max_ms,
        },
    }
    failures = []
    if metrics["warmupElapsedMs"] > args.cold_max_ms:
        failures.append("cold_warmup")
    if metrics["wallMs"]["p95"] > args.warm_p95_max_ms:
        failures.append("warm_wall_p95")
    if metrics["streamFirstAudioMs"]["p95"] > args.first_audio_p95_max_ms:
        failures.append("stream_first_audio_p95")
    metrics["passed"] = not failures
    metrics["failures"] = failures
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    return 0 if not failures else 1


def post_json(url: str, payload: dict, api_key: str) -> dict:
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        return json.load(response)


def post_stream(url: str, payload: dict, api_key: str) -> dict[str, int]:
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    started = time.perf_counter()
    with urlopen(request, timeout=120) as response:
        return consume_stream(response, started)


def consume_stream(response, started: float, clock=time.perf_counter) -> dict[str, int]:
    model_first_audio_ms: int | None = None
    first_audio_ms: int | None = None
    final_seen = False
    for raw_line in response:
        line = raw_line.decode("utf-8").strip()
        if not line:
            continue
        event = json.loads(line)
        if event.get("type") == "metadata":
            model_first_audio_ms = int(event["firstAudioMs"])
        elif event.get("type") == "audio_chunk" and event.get("data"):
            if first_audio_ms is None:
                first_audio_ms = round((clock() - started) * 1000)
        elif event.get("type") == "final":
            final_seen = True
    wall_ms = round((clock() - started) * 1000)
    if model_first_audio_ms is None:
        raise ValueError("TTS stream returned no firstAudioMs metadata")
    if first_audio_ms is None:
        raise ValueError("TTS stream returned no playable audio chunk")
    if not final_seen:
        raise ValueError("TTS stream ended without a final event")
    return {
        "wallMs": wall_ms,
        "modelFirstAudioMs": model_first_audio_ms,
        "firstAudioMs": first_audio_ms,
    }


def request_payload(segment_id: str, text: str) -> dict:
    return {
        "text": text,
        "language": "zh",
        "speakerRole": "host",
        "segmentId": segment_id,
    }


def sample_text(index: int) -> str:
    samples = (
        "您好，我们正在进行实时翻译延迟测试。",
        "请确认明天下午三点的会议安排。",
        "订单编号 A-120，金额三十一点五美元。",
    )
    return samples[index % len(samples)]


def summary(values: list[int]) -> dict:
    ordered = sorted(values)
    return {
        "min": ordered[0],
        "p50": round(statistics.median(ordered)),
        "p95": ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)],
        "max": ordered[-1],
    }


if __name__ == "__main__":
    raise SystemExit(main())
