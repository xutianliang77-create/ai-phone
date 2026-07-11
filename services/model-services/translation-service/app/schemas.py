from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str
    provider: str
    modelVersion: str
    available: bool
    reason: str | None = None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = None
    top_p: float | None = None
    stream: bool | None = None


class ChatCompletionMessage(BaseModel):
    role: str = "assistant"
    content: str


class ChatCompletionChoice(BaseModel):
    index: int = 0
    message: ChatCompletionMessage
    finish_reason: str = "stop"


class ChatCompletionResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[ChatCompletionChoice]
    usage: dict[str, int] = Field(default_factory=dict)


class ModelCard(BaseModel):
    id: str
    object: str = "model"


class ModelsResponse(BaseModel):
    object: str = "list"
    data: list[ModelCard]
