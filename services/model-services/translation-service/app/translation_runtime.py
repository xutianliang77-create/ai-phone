import asyncio
from dataclasses import dataclass

from app.config import TranslationConfig
from app.engines import TranslationInput
from app.schemas import ChatCompletionRequest
from app.service import TranslationService


class TranslationCapacityError(RuntimeError):
    pass


class TranslationQueueTimeout(RuntimeError):
    pass


class TranslationExecutionLease:
    def __init__(self, admission: "TranslationAdmission"):
        self._admission = admission
        self._released = False

    async def release(self) -> None:
        if self._released:
            return
        self._released = True
        await self._admission.release()


class TranslationAdmission:
    def __init__(self, max_concurrency: int, max_waiters: int, timeout_ms: int):
        if not 1 <= max_concurrency <= 32:
            raise ValueError("TRANSLATION_MAX_CONCURRENCY must be 1-32")
        if not 1 <= max_waiters <= 4096:
            raise ValueError("TRANSLATION_MAX_QUEUE_SIZE must be 1-4096")
        if not 10 <= timeout_ms <= 120_000:
            raise ValueError("TRANSLATION_QUEUE_TIMEOUT_MS must be 10-120000")
        self.max_concurrency = max_concurrency
        self.max_waiters = max_waiters
        self.timeout_seconds = timeout_ms / 1000
        self.active = 0
        self.waiting = 0
        self.rejected = 0
        self.timed_out = 0
        self._condition = asyncio.Condition()

    async def acquire(self) -> TranslationExecutionLease:
        async with self._condition:
            if self.active >= self.max_concurrency:
                if self.waiting >= self.max_waiters:
                    self.rejected += 1
                    raise TranslationCapacityError("translation execution queue is full")
                self.waiting += 1
                try:
                    await asyncio.wait_for(
                        self._condition.wait_for(
                            lambda: self.active < self.max_concurrency,
                        ),
                        timeout=self.timeout_seconds,
                    )
                except TimeoutError as exc:
                    self.timed_out += 1
                    raise TranslationQueueTimeout(
                        "translation execution queue timed out",
                    ) from exc
                finally:
                    self.waiting -= 1
            self.active += 1
        return TranslationExecutionLease(self)

    async def release(self) -> None:
        async with self._condition:
            if self.active <= 0:
                raise RuntimeError("translation execution lease underflow")
            self.active -= 1
            self._condition.notify(1)


@dataclass
class PendingTranslation:
    request: TranslationInput
    started: asyncio.Future[None]
    future: asyncio.Future[str]


class TranslationBatchScheduler:
    def __init__(
        self,
        service: TranslationService,
        admission: TranslationAdmission,
        config: TranslationConfig,
    ):
        if not 1 <= config.micro_batch_size <= 32:
            raise ValueError("TRANSLATION_MICRO_BATCH_SIZE must be 1-32")
        if not 0 <= config.micro_batch_window_ms <= 100:
            raise ValueError("TRANSLATION_MICRO_BATCH_WINDOW_MS must be 0-100")
        self.service = service
        self.admission = admission
        self.max_queue_size = config.max_queue_size
        self.timeout_seconds = config.queue_timeout_ms / 1000
        self.batch_size = config.micro_batch_size
        self.batch_window_seconds = config.micro_batch_window_ms / 1000
        self.pending: list[PendingTranslation] = []
        self.batches = 0
        self.completed = 0
        self.rejected = 0
        self.timed_out = 0
        self._lock = asyncio.Lock()
        self._runner: asyncio.Task[None] | None = None

    async def submit(self, request: TranslationInput) -> str:
        loop = asyncio.get_running_loop()
        started: asyncio.Future[None] = loop.create_future()
        future: asyncio.Future[str] = loop.create_future()
        pending = PendingTranslation(request=request, started=started, future=future)
        async with self._lock:
            if len(self.pending) >= self.max_queue_size:
                self.rejected += 1
                raise TranslationCapacityError("translation micro-batch queue is full")
            self.pending.append(pending)
            if self._runner is None or self._runner.done():
                self._runner = asyncio.create_task(self._run())
        try:
            await asyncio.wait_for(
                asyncio.shield(started),
                timeout=self.timeout_seconds,
            )
            return await future
        except TimeoutError as exc:
            self.timed_out += 1
            started.cancel()
            future.cancel()
            async with self._lock:
                if pending in self.pending:
                    self.pending.remove(pending)
            raise TranslationQueueTimeout(
                "translation micro-batch queue timed out",
            ) from exc

    async def _run(self) -> None:
        while True:
            if self.batch_window_seconds:
                await asyncio.sleep(self.batch_window_seconds)
            async with self._lock:
                batch = self._take_compatible_batch()
                if not batch:
                    self._runner = None
                    return
            await self._execute(batch)

    def _take_compatible_batch(self) -> list[PendingTranslation]:
        active = [item for item in self.pending if not item.future.done()]
        self.pending = active
        if not active:
            return []
        max_tokens = active[0].request.max_tokens
        batch = [
            item for item in active
            if item.request.max_tokens == max_tokens
        ][:self.batch_size]
        selected = {id(item) for item in batch}
        self.pending = [item for item in active if id(item) not in selected]
        return batch

    async def _execute(self, batch: list[PendingTranslation]) -> None:
        lease: TranslationExecutionLease | None = None
        try:
            lease = await self.admission.acquire()
            active = [item for item in batch if not item.future.done()]
            for item in active:
                if not item.started.done():
                    item.started.set_result(None)
            if not active:
                return
            results = await asyncio.to_thread(
                self.service.translate_batch,
                [item.request for item in active],
            )
            if len(results) != len(active):
                raise RuntimeError("translation batch result count mismatch")
            self.batches += 1
            for item, result in zip(active, results, strict=True):
                if not item.future.done():
                    item.future.set_result(result)
                    self.completed += 1
        except Exception as exc:
            for item in batch:
                if not item.started.done():
                    item.started.set_exception(exc)
                if not item.future.done():
                    item.future.set_exception(exc)
        finally:
            if lease is not None:
                await lease.release()


class TranslationRuntime:
    def __init__(self, service: TranslationService, config: TranslationConfig):
        self.service = service
        self.admission = TranslationAdmission(
            config.max_concurrency,
            config.max_queue_size,
            config.queue_timeout_ms,
        )
        self.batcher = TranslationBatchScheduler(service, self.admission, config)

    async def translate(self, request: ChatCompletionRequest) -> str:
        return await self.batcher.submit(self.service.translation_input(request))

    async def acquire_stream(self) -> TranslationExecutionLease:
        return await self.admission.acquire()

    def metrics(self) -> dict[str, int]:
        return {
            "active": self.admission.active,
            "waiting": self.admission.waiting,
            "pending": len(self.batcher.pending),
            "batches": self.batcher.batches,
            "completed": self.batcher.completed,
            "rejected": self.admission.rejected + self.batcher.rejected,
            "timed_out": self.admission.timed_out + self.batcher.timed_out,
        }
