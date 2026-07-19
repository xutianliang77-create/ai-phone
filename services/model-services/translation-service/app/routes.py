from hmac import compare_digest
import asyncio
from time import time
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Response, status
from fastapi.responses import StreamingResponse
import json

from app.config import TranslationConfig
from app.schemas import (
    ChatCompletionChoice,
    ChatCompletionMessage,
    ChatCompletionRequest,
    ChatCompletionResponse,
    HealthResponse,
    ModelCard,
    ModelsResponse,
)
from app.runtime_observability import (
    RuntimeIdentity,
    prometheus_model_metrics,
    require_metrics_token,
)
from app.service import TranslationService
from app.translation_runtime import (
    TranslationExecutionLease,
    TranslationRuntime,
)


def create_router(
    service: TranslationService,
    config: TranslationConfig,
    runtime_identity: RuntimeIdentity,
) -> APIRouter:
    router = APIRouter()
    runtime = TranslationRuntime(service, config)

    @router.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        available, reason = service.health()
        return HealthResponse(
            status="ok" if available else "degraded",
            service="translation-service",
            provider=config.provider,
            modelVersion=config.model_version,
            available=available,
            reason=reason,
            runtimeSignatureVersion=runtime_identity.signature_version,
            runtimeFingerprint=runtime_identity.fingerprint,
        )

    @router.get("/metrics")
    async def metrics(
        authorization: str | None = Header(default=None),
    ) -> Response:
        require_metrics_token(config.metrics_bearer_token, authorization)
        available, _reason = service.health()
        return Response(
            content=prometheus_model_metrics(
                runtime_identity,
                available,
                runtime.metrics(),
            ),
            media_type="text/plain; version=0.0.4",
        )

    @router.get("/v1/models", response_model=ModelsResponse)
    async def models() -> ModelsResponse:
        return ModelsResponse(data=[ModelCard(id=config.model_version)])

    @router.post(
        "/v1/chat/completions",
        response_model=ChatCompletionResponse,
        status_code=status.HTTP_200_OK,
    )
    async def chat_completions(
        request: ChatCompletionRequest,
        authorization: str | None = Header(default=None),
    ) -> ChatCompletionResponse:
        require_api_key(config, authorization)
        try:
            if request.stream:
                lease = await runtime.acquire_stream()
                return StreamingResponse(
                    openai_sse_stream(
                        service,
                        request,
                        config.model_version,
                        lease,
                    ),
                    media_type="text/event-stream",
                    headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
                )
            translated = await runtime.translate(request)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return ChatCompletionResponse(
            id=f"chatcmpl-{uuid4().hex}",
            created=int(time()),
            model=config.model_version,
            choices=[ChatCompletionChoice(
                message=ChatCompletionMessage(content=translated),
            )],
            usage={
                "prompt_tokens": estimate_tokens(request),
                "completion_tokens": max(1, len(translated) // 2),
                "total_tokens": estimate_tokens(request) + max(1, len(translated) // 2),
            },
        )

    return router


async def openai_sse_stream(
    service: TranslationService,
    request: ChatCompletionRequest,
    model: str,
    lease: TranslationExecutionLease,
):
    completion_id = f"chatcmpl-{uuid4().hex}"
    created = int(time())
    iterator = None
    try:
        iterator = iter(service.translate_chat_stream(request))
        while True:
            available, chunk = await next_chunk_async(iterator)
            if not available:
                break
            yield "data: " + json.dumps({
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {"content": chunk},
                    "finish_reason": None,
                }],
            }, ensure_ascii=False) + "\n\n"
        yield "data: " + json.dumps({
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": "stop",
            }],
        }) + "\n\n"
        yield "data: [DONE]\n\n"
    finally:
        close = getattr(iterator, "close", None) if iterator is not None else None
        if close:
            close()
        await lease.release()


def next_chunk(iterator) -> tuple[bool, str]:
    try:
        return True, next(iterator)
    except StopIteration:
        return False, ""


async def next_chunk_async(iterator) -> tuple[bool, str]:
    task = asyncio.create_task(asyncio.to_thread(next_chunk, iterator))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            await task
        finally:
            raise


def require_api_key(config: TranslationConfig, authorization: str | None) -> None:
    if not config.api_key:
        return
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing translation service API key")
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="Invalid translation service auth scheme")
    if not compare_digest(authorization[len(prefix):], config.api_key):
        raise HTTPException(status_code=403, detail="Invalid translation service API key")


def estimate_tokens(request: ChatCompletionRequest) -> int:
    total = sum(len(message.content) for message in request.messages)
    return max(1, total // 2)
