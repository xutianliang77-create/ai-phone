from hmac import compare_digest
import asyncio
from time import time
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, status
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
from app.service import TranslationService


def create_router(service: TranslationService, config: TranslationConfig) -> APIRouter:
    router = APIRouter()

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
                return StreamingResponse(
                    openai_sse_stream(service, request, config.model_version),
                    media_type="text/event-stream",
                    headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
                )
            translated = await asyncio.to_thread(service.translate_chat, request)
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


def openai_sse_stream(
    service: TranslationService,
    request: ChatCompletionRequest,
    model: str,
):
    completion_id = f"chatcmpl-{uuid4().hex}"
    created = int(time())
    for chunk in service.translate_chat_stream(request):
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
