from dataclasses import dataclass


@dataclass
class _VadStats:
    analyzed: int = 0
    speech: int = 0
    probability_total: float = 0.0
    probability_count: int = 0
    probability_min: float | None = None
    probability_max: float | None = None


class VadMetricsStore:
    def __init__(self) -> None:
        self._sessions: dict[str, _VadStats] = {}

    def record(
        self,
        session_id: str,
        voiced: bool,
        probability: float | None,
    ) -> None:
        stats = self._sessions.setdefault(session_id, _VadStats())
        stats.analyzed += 1
        stats.speech += int(voiced)
        if probability is None:
            return
        stats.probability_total += probability
        stats.probability_count += 1
        stats.probability_min = (
            probability if stats.probability_min is None
            else min(stats.probability_min, probability)
        )
        stats.probability_max = (
            probability if stats.probability_max is None
            else max(stats.probability_max, probability)
        )

    def snapshot(self, session_id: str) -> dict[str, object]:
        stats = self._sessions.get(session_id, _VadStats())
        result: dict[str, object] = {
            "analyzedFrameCount": stats.analyzed,
            "speechFrameCount": stats.speech,
            "speechFrameRatio": (
                stats.speech / stats.analyzed if stats.analyzed else 0.0
            ),
        }
        if stats.probability_count:
            result.update({
                "probabilityMin": stats.probability_min,
                "probabilityMax": stats.probability_max,
                "probabilityMean": stats.probability_total / stats.probability_count,
            })
        return result

    def clear(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
