import asyncio
import logging
from dataclasses import dataclass
from time import monotonic
from typing import Callable, Literal

from app.config import AsrConfig
from app.model_loader import AsrEngine
from app.service import AsrService


LOGGER = logging.getLogger(__name__)
RuntimeState = Literal[
    "created",
    "loading",
    "warming",
    "ready",
    "failed",
    "stopping",
    "stopped",
]


@dataclass(frozen=True)
class RuntimeUnavailable(Exception):
    code: str
    state: RuntimeState
    status_code: int
    generation: int


class ResidentAsrRuntime:
    def __init__(
        self,
        config: AsrConfig,
        engine_loader: Callable[[AsrConfig], AsrEngine],
    ) -> None:
        if config.qwen3_startup_timeout_ms <= 0:
            raise ValueError("ASR_QWEN3_STARTUP_TIMEOUT_MS must be positive")
        if config.qwen3_max_active_sessions <= 0:
            raise ValueError("ASR_QWEN3_MAX_ACTIVE_SESSIONS must be positive")
        self.config = config
        self._engine_loader = engine_loader
        self._state: RuntimeState = "created"
        self._generation = 0
        self._error_code: str | None = None
        self._service: AsrService | None = None
        self._active_sessions: set[str] = set()
        self._initializer: asyncio.Task[None] | None = None
        self._load_task: asyncio.Task[AsrEngine] | None = None
        self._lock = asyncio.Lock()
        self._started_at: float | None = None
        self._ready_at: float | None = None

    @property
    def service(self) -> AsrService | None:
        return self._service

    @property
    def is_ready(self) -> bool:
        return self._state == "ready" and self._service is not None

    async def start(self) -> None:
        async with self._lock:
            if self._state not in ("created", "stopped"):
                return
            self._generation += 1
            generation = self._generation
            self._state = "loading"
            self._error_code = None
            self._started_at = monotonic()
            self._ready_at = None
            self._initializer = asyncio.create_task(
                self._initialize(generation),
                name=f"qwen3-asr-loader-{generation}",
            )

    async def stop(self) -> None:
        async with self._lock:
            if self._state == "stopped":
                return
            self._state = "stopping"
            self._generation += 1
            initializer = self._initializer
            service = self._service
            self._service = None
            self._active_sessions.clear()
        if initializer is not None and not initializer.done():
            await initializer
        if service is not None:
            await self._shutdown_engine(service.engine)
        async with self._lock:
            self._state = "stopped"

    async def ready_service(self) -> AsrService:
        async with self._lock:
            return self._require_ready()

    async def admit(self, session_id: str) -> AsrService:
        async with self._lock:
            service = self._require_ready()
            if session_id in self._active_sessions:
                return service
            if len(self._active_sessions) >= self.config.qwen3_max_active_sessions:
                raise RuntimeUnavailable(
                    code="asr_capacity_exceeded",
                    state=self._state,
                    status_code=429,
                    generation=self._generation,
                )
            self._active_sessions.add(session_id)
            return service

    async def release(self, session_id: str) -> None:
        async with self._lock:
            self._active_sessions.discard(session_id)

    def snapshot(self) -> dict[str, object]:
        ready_wall_ms = None
        if self._started_at is not None and self._ready_at is not None:
            ready_wall_ms = round((self._ready_at - self._started_at) * 1000, 3)
        return {
            "state": self._state,
            "ready": self.is_ready,
            "generation": self._generation,
            "errorCode": self._error_code,
            "activeSessions": len(self._active_sessions),
            "maxActiveSessions": self.config.qwen3_max_active_sessions,
            "readyWallMs": ready_wall_ms,
        }

    async def _initialize(self, generation: int) -> None:
        timeout_seconds = self.config.qwen3_startup_timeout_ms / 1000
        self._load_task = asyncio.create_task(
            asyncio.to_thread(self._engine_loader, self.config),
            name=f"qwen3-asr-engine-load-{generation}",
        )
        try:
            engine = await asyncio.wait_for(
                asyncio.shield(self._load_task),
                timeout=timeout_seconds,
            )
        except TimeoutError:
            await self._fail(generation, "asr_startup_timeout")
            try:
                late_engine = await self._load_task
            except Exception:
                return
            await self._shutdown_engine(late_engine)
            return
        except Exception:
            LOGGER.exception("Qwen3-ASR model load failed")
            await self._fail(generation, "asr_model_load_failed")
            return

        async with self._lock:
            if generation != self._generation or self._state != "loading":
                stale = True
            else:
                self._state = "warming"
                stale = False
        if stale:
            await self._shutdown_engine(engine)
            return

        elapsed = monotonic() - (self._started_at or monotonic())
        remaining = max(0.001, timeout_seconds - elapsed)
        warmup = getattr(engine, "prewarm", None)
        if warmup is not None:
            warmup_task = asyncio.create_task(
                asyncio.to_thread(warmup),
                name=f"qwen3-asr-warmup-{generation}",
            )
            try:
                await asyncio.wait_for(asyncio.shield(warmup_task), timeout=remaining)
            except TimeoutError:
                await self._fail(generation, "asr_startup_timeout")
                try:
                    await warmup_task
                except Exception:
                    pass
                await self._shutdown_engine(engine)
                return
            except Exception:
                LOGGER.exception("Qwen3-ASR model warmup failed")
                await self._fail(generation, "asr_model_warmup_failed")
                await self._shutdown_engine(engine)
                return

        service = AsrService(engine)
        async with self._lock:
            if generation != self._generation or self._state != "warming":
                stale = True
            else:
                self._service = service
                self._state = "ready"
                self._ready_at = monotonic()
                stale = False
        if stale:
            await self._shutdown_engine(engine)

    async def _fail(self, generation: int, code: str) -> None:
        async with self._lock:
            if generation == self._generation and self._state not in (
                "stopping",
                "stopped",
            ):
                self._state = "failed"
                self._error_code = code

    def _require_ready(self) -> AsrService:
        if self._state == "ready" and self._service is not None:
            return self._service
        code = {
            "loading": "asr_loading",
            "warming": "asr_warming",
            "failed": self._error_code or "asr_failed",
            "stopping": "asr_stopping",
            "stopped": "asr_stopped",
        }.get(self._state, "asr_not_started")
        raise RuntimeUnavailable(
            code=code,
            state=self._state,
            status_code=503,
            generation=self._generation,
        )

    async def _shutdown_engine(self, engine: AsrEngine) -> None:
        shutdown = getattr(engine, "shutdown", None)
        if shutdown is None:
            return
        try:
            await asyncio.to_thread(shutdown)
        except Exception:
            LOGGER.exception("Qwen3-ASR model shutdown failed")
