from fastapi.testclient import TestClient

from app.config import TranslationConfig
from app.main import create_app


def test_health_route_mock() -> None:
    client = TestClient(create_app(TranslationConfig()))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "translation-service",
        "provider": "mock",
        "modelVersion": "tencent/Hy-MT2-1.8B",
        "available": True,
        "reason": None,
    }


def test_models_route_is_openai_compatible() -> None:
    client = TestClient(create_app(TranslationConfig()))

    response = client.get("/v1/models")

    assert response.status_code == 200
    assert response.json()["data"][0]["id"] == "tencent/Hy-MT2-1.8B"


def test_chat_completions_translates_to_chinese() -> None:
    client = TestClient(create_app(TranslationConfig()))

    response = client.post("/v1/chat/completions", json=payload(
        system="Translate the user text into Simplified Chinese.",
        user="hello, this is a domestic release smoke test",
    ))

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"].startswith("你好")


def test_chat_completions_extracts_source_text_block() -> None:
    client = TestClient(create_app(TranslationConfig()))

    response = client.post("/v1/chat/completions", json=payload(
        system="把 SOURCE_TEXT 标记内的简体中文原文翻译成英文。",
        user="SOURCE_TEXT\n那我等会儿给你发图纸。\nEND_SOURCE_TEXT",
    ))

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == (
        "I will send you the drawings later."
    )


def test_chat_completions_detects_japanese_target_language() -> None:
    client = TestClient(create_app(TranslationConfig()))

    response = client.post("/v1/chat/completions", json=payload(
        system="Translate the user's text into Japanese.",
        user="你好",
    ))

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == "これは翻訳です。"


def test_chat_completions_detects_french_target_language() -> None:
    client = TestClient(create_app(TranslationConfig()))

    response = client.post("/v1/chat/completions", json=payload(
        system="请把用户文本翻译成法语。",
        user="你好",
    ))

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == (
        "Ceci est une traduction."
    )


def test_chat_completions_requires_api_key_when_configured() -> None:
    client = TestClient(create_app(TranslationConfig(api_key="translation-secret")))

    response = client.post("/v1/chat/completions", json=payload())

    assert response.status_code == 401


def test_chat_completions_accepts_configured_api_key() -> None:
    client = TestClient(create_app(TranslationConfig(api_key="translation-secret")))

    response = client.post(
        "/v1/chat/completions",
        json=payload(),
        headers={"authorization": "Bearer translation-secret"},
    )

    assert response.status_code == 200


def payload(system: str = "Translate into Simplified Chinese.", user: str = "hello") -> dict:
    return {
        "model": "tencent/Hy-MT2-1.8B",
        "temperature": 0,
        "max_tokens": 128,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
