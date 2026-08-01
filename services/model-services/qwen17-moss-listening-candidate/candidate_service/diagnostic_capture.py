from __future__ import annotations

import os
import re
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class _OpenCapture:
    writer: wave.Wave_write
    sample_rate: int
    written_frames: int = 0


class DiagnosticCapture:
    def __init__(
        self,
        directory: str = "",
        *,
        max_sessions: int = 0,
        max_seconds: int = 60,
    ) -> None:
        self.directory = Path(directory) if directory else None
        self.max_sessions = max(0, max_sessions)
        self.max_seconds = max(1, max_seconds)
        self._captures: dict[str, _OpenCapture] = {}
        self._accepted_sessions: set[str] = set()
        if self.enabled:
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.directory.chmod(0o700)

    @property
    def enabled(self) -> bool:
        return self.directory is not None and self.max_sessions > 0

    def append(
        self,
        session_id: str,
        pcm: np.ndarray,
        sample_rate: int,
    ) -> None:
        if not self.enabled or not len(pcm):
            return
        capture = self._captures.get(session_id)
        if capture is None:
            if session_id in self._accepted_sessions:
                return
            if len(self._accepted_sessions) >= self.max_sessions:
                return
            capture = self._open(session_id, sample_rate)
        if capture.sample_rate != sample_rate:
            self.close_session(session_id)
            return
        remaining = (
            capture.sample_rate * self.max_seconds - capture.written_frames
        )
        if remaining <= 0:
            self.close_session(session_id)
            return
        samples = pcm[:remaining].astype("<i2", copy=False)
        capture.writer.writeframes(samples.tobytes())
        capture.written_frames += len(samples)
        if capture.written_frames >= capture.sample_rate * self.max_seconds:
            self.close_session(session_id)

    def close_session(self, session_id: str) -> None:
        capture = self._captures.pop(session_id, None)
        if capture is not None:
            capture.writer.close()

    def shutdown(self) -> None:
        for session_id in list(self._captures):
            self.close_session(session_id)

    def diagnostics(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "maxSessions": self.max_sessions,
            "maxSeconds": self.max_seconds,
            "acceptedSessions": len(self._accepted_sessions),
        }

    def _open(self, session_id: str, sample_rate: int) -> _OpenCapture:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", session_id):
            raise ValueError("sessionId is unsafe for diagnostic capture")
        path = self.directory / f"{session_id}.wav"
        handle = os.fdopen(
            os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
            "wb",
        )
        writer = wave.open(handle, "wb")
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        capture = _OpenCapture(writer=writer, sample_rate=sample_rate)
        self._captures[session_id] = capture
        self._accepted_sessions.add(session_id)
        return capture
