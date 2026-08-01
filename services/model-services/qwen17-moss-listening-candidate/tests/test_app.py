from fastapi.testclient import TestClient

from candidate_service.app import create_app


class BoundaryEngine:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, int]] = []

    def commit_boundary(
        self,
        session_id: str,
        source_language: str,
        boundary_ms: int,
    ) -> dict[str, object]:
        self.calls.append((session_id, source_language, boundary_ms))
        return {
            "segmentId": "boundary_1",
            "text": "first speaker",
            "language": "en",
        }

    def shutdown(self) -> None:
        return None


def test_boundary_route_forwards_the_confirmed_timestamp() -> None:
    engine = BoundaryEngine()
    with TestClient(create_app(engine=engine)) as client:
        response = client.post(
            "/asr/sessions/session-1/boundary",
            json={
                "sourceLanguage": "zh-CN",
                "targetLanguage": "en",
                "mode": "listening",
                "boundaryMs": 1480,
            },
        )

    assert response.status_code == 200
    assert response.json()["segmentId"] == "boundary_1"
    assert engine.calls == [("session-1", "zh-CN", 1480)]


def test_boundary_route_rejects_a_request_without_the_timestamp() -> None:
    engine = BoundaryEngine()
    with TestClient(create_app(engine=engine)) as client:
        response = client.post(
            "/asr/sessions/session-1/boundary",
            json={
                "sourceLanguage": "zh-CN",
                "targetLanguage": "en",
                "mode": "listening",
            },
        )

    assert response.status_code == 422
    assert engine.calls == []
