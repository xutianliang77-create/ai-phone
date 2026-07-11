#!/usr/bin/env python3
import argparse
import base64
import json
from pathlib import Path
import time
import urllib.request
import uuid
import wave


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--api-key")
    parser.add_argument("--frame-ms", type=int, default=1000)
    parser.add_argument("--max-speakers", type=int, default=4)
    parser.add_argument(
        "--realtime",
        action="store_true",
        help="pace audio frames against wall-clock time",
    )
    args = parser.parse_args()

    session_id = f"shadow-eval-{uuid.uuid4()}"
    request_json(
        args,
        "/speaker/sessions",
        {
            "sessionId": session_id,
            "options": {
                "mode": "diarization",
                "maxSpeakers": args.max_speakers,
                "allowVoiceIdentity": False,
            },
        },
        expect_json=False,
    )
    spans = []
    try:
        with wave.open(args.audio, "rb") as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
                raise ValueError("audio must be mono pcm16")
            sample_rate = audio.getframerate()
            frames_per_request = sample_rate * args.frame_ms // 1000
            sequence = 0
            timestamp_ms = 0
            started_at = time.monotonic()
            while True:
                pcm = audio.readframes(frames_per_request)
                if not pcm:
                    break
                sequence += 1
                response = request_json(args, "/speaker/frames", {
                    "type": "audio.frame",
                    "sessionId": session_id,
                    "sequence": sequence,
                    "timestampMs": timestamp_ms,
                    "format": "pcm16",
                    "sampleRate": sample_rate,
                    "data": base64.b64encode(pcm).decode("ascii"),
                })
                spans.extend(response.get("spans", []))
                timestamp_ms += len(pcm) * 1000 // (sample_rate * 2)
                if args.realtime:
                    target_at = started_at + timestamp_ms / 1000
                    time.sleep(max(0, target_at - time.monotonic()))
        flushed = request_json(
            args,
            f"/speaker/sessions/{session_id}/flush",
            None,
        )
        spans.extend(flushed.get("spans", []))
    finally:
        request_json(
            args,
            f"/speaker/sessions/{session_id}",
            None,
            method="DELETE",
            expect_json=False,
        )
    payload = {
        "sessionId": session_id,
        "audio": str(Path(args.audio).resolve()),
        "durationMs": timestamp_ms,
        "predicted": spans,
    }
    Path(args.output).write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({
        "sessionId": session_id,
        "durationMs": timestamp_ms,
        "segments": len(spans),
        "speakers": sorted({span["speakerId"] for span in spans}),
    }))


def request_json(
    args,
    path: str,
    payload,
    method: str = "POST",
    expect_json: bool = True,
):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {"content-type": "application/json"}
    if args.api_key:
        headers["authorization"] = f"Bearer {args.api_key}"
    request = urllib.request.Request(
        f"{args.base_url.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read()
    return json.loads(body) if expect_json and body else {}


if __name__ == "__main__":
    main()
