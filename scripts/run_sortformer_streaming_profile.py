#!/usr/bin/env python3
import argparse
import asyncio
import base64
import json
from pathlib import Path
import sys
import uuid
import wave


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-dir", required=True)
    parser.add_argument("--suite", nargs="+", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--frame-ms", type=int, default=80)
    parser.add_argument("--chunk-len", type=int, default=6)
    parser.add_argument("--chunk-left-context", type=int, default=1)
    parser.add_argument("--chunk-right-context", type=int, default=7)
    parser.add_argument("--fifo-len", type=int, default=188)
    parser.add_argument("--cache-update-period", type=int, default=144)
    parser.add_argument("--cache-len", type=int, default=188)
    parser.add_argument("--onset", type=float, default=0.5)
    parser.add_argument("--offset", type=float, default=0.5)
    parser.add_argument("--pad-offset-ms", type=int, default=0)
    parser.add_argument("--min-duration-on-ms", type=int, default=0)
    parser.add_argument("--min-duration-off-ms", type=int, default=0)
    args = parser.parse_args()

    sys.path.insert(0, str(Path(args.service_dir).resolve()))
    payload = asyncio.run(run(args))
    Path(args.output).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "output": args.output,
        "cases": len(payload["cases"]),
        "segments": sum(len(case["predicted"]) for case in payload["cases"]),
    }))


async def run(args) -> dict[str, object]:
    from app.sortformer_shadow_engine import SortformerShadowEngine
    from app.sortformer_streaming_runtime import StreamingProfile

    engine = SortformerShadowEngine(
        model_id=args.model,
        profile=StreamingProfile(
            chunk_len=args.chunk_len,
            chunk_left_context=args.chunk_left_context,
            chunk_right_context=args.chunk_right_context,
            fifo_len=args.fifo_len,
            spkcache_update_period=args.cache_update_period,
            spkcache_len=args.cache_len,
        ),
        onset=args.onset,
        offset=args.offset,
        pad_offset_ms=args.pad_offset_ms,
        min_duration_on_ms=args.min_duration_on_ms,
        min_duration_off_ms=args.min_duration_off_ms,
    )
    cases = []
    for suite_path in args.suite:
        suite = json.loads(Path(suite_path).read_text())
        suite_dir = Path(suite_path).resolve().parent
        for case in suite["cases"]:
            audio_path = Path(case["audio"])
            if not audio_path.is_absolute():
                audio_path = suite_dir / audio_path
            cases.append({
                **case,
                "audio": str(audio_path),
                "predicted": await run_case(engine, audio_path, args.frame_ms),
            })
    return {
        "schemaVersion": 1,
        "model": args.model,
        "profile": {
            "chunkLen": args.chunk_len,
            "chunkLeftContext": args.chunk_left_context,
            "chunkRightContext": args.chunk_right_context,
            "fifoLen": args.fifo_len,
            "cacheUpdatePeriod": args.cache_update_period,
            "cacheLen": args.cache_len,
            "onset": args.onset,
            "offset": args.offset,
            "padOffsetMs": args.pad_offset_ms,
            "minDurationOnMs": args.min_duration_on_ms,
            "minDurationOffMs": args.min_duration_off_ms,
        },
        "cases": cases,
    }


async def run_case(engine, audio_path: Path, frame_ms: int) -> list[dict[str, object]]:
    from app.schemas import (
        CreateSpeakerSessionRequest,
        SpeakerAudioFrame,
        SpeakerOptions,
    )

    session_id = f"stream-profile-{uuid.uuid4()}"
    await engine.create_session(CreateSpeakerSessionRequest(
        sessionId=session_id,
        options=SpeakerOptions(
            mode="diarization",
            maxSpeakers=4,
            allowVoiceIdentity=False,
        ),
    ))
    indexed: dict[tuple[str, int, bool], dict[str, object]] = {}
    try:
        with wave.open(str(audio_path), "rb") as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
                raise ValueError("audio must be mono PCM16")
            sample_rate = audio.getframerate()
            frames_per_request = sample_rate * frame_ms // 1000
            sequence = 0
            timestamp_ms = 0
            while pcm := audio.readframes(frames_per_request):
                sequence += 1
                spans = await engine.push_audio(SpeakerAudioFrame(
                    type="audio.frame",
                    sessionId=session_id,
                    sequence=sequence,
                    timestampMs=timestamp_ms,
                    format="pcm16",
                    sampleRate=sample_rate,
                    data=base64.b64encode(pcm).decode("ascii"),
                ))
                timestamp_ms += len(pcm) * 1000 // (sample_rate * 2)
                retain(indexed, spans, timestamp_ms)
        retain(indexed, await engine.flush(session_id), timestamp_ms)
    finally:
        await engine.close_session(session_id)
    return sorted(
        indexed.values(),
        key=lambda item: (item["startMs"], item["endMs"], item["speakerId"]),
    )


def retain(indexed, spans, observed_audio_ms: int) -> None:
    for span in spans:
        payload = span.model_dump()
        key = (span.speakerId, span.startMs, span.overlap)
        previous = indexed.get(key)
        first_observed = (
            previous["firstObservedAudioMs"]
            if previous is not None
            else observed_audio_ms
        )
        if (
            previous is None
            or span.final
            or span.endMs >= int(previous["endMs"])
        ):
            indexed[key] = {
                **payload,
                "firstObservedAudioMs": first_observed,
            }


if __name__ == "__main__":
    main()
