from __future__ import annotations

import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable

import numpy as np

from candidate_service.models import MossRunner
from candidate_service.policy import gate_revision


@dataclass(frozen=True)
class RevisionResult:
    decision: dict[str, object] | None
    latency_ms: float | None
    error: bool = False


class RevisionWorker:
    def __init__(self, moss: MossRunner, gpu_lock: threading.Lock) -> None:
        self._moss = moss
        self._gpu_lock = gpu_lock
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="moss-revision",
        )

    def submit(
        self,
        draft_text: str,
        audio: np.ndarray,
        callback: Callable[[RevisionResult], None],
    ) -> Future:
        started = time.perf_counter()

        def run() -> RevisionResult:
            try:
                with self._gpu_lock:
                    revision_text, speaker_count = self._moss.transcribe(audio)
                decision = gate_revision(
                    draft_text=draft_text,
                    revision_text=revision_text,
                    speaker_count=speaker_count,
                )
                return RevisionResult(
                    decision,
                    (time.perf_counter() - started) * 1000,
                )
            except Exception:
                return RevisionResult(None, None, error=True)

        future = self._executor.submit(run)
        future.add_done_callback(lambda done: callback(done.result()))
        return future

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
