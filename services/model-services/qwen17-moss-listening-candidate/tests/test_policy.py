from candidate_service.policy import gate_revision, protected_surfaces


def test_accepts_only_the_locally_confirmed_duplicate_deletion() -> None:
    decision = gate_revision(
        draft_text=(
            "No carga y y tampoco voy a quitar saldo. "
            "La necesito inmediatamente."
        ),
        revision_text=(
            "No carga y tampoco voy a quitar saldo. "
            "Me necesite inmediatamente."
        ),
        speaker_count=1,
    )

    assert decision["selectedLane"] == "surgical_duplicate_patch"
    assert decision["text"] == (
        "No carga y tampoco voy a quitar saldo. "
        "La necesito inmediatamente."
    )


def test_rejects_zero_error_short_sentences_and_multiple_speakers() -> None:
    unchanged = gate_revision(
        draft_text="Bonjour, je voudrais changer d'adresse.",
        revision_text="Bonjour, je voudrais changer d'adresse.",
        speaker_count=1,
    )
    overlap = gate_revision(
        draft_text="We need need the API version 2.",
        revision_text="We need the API version 2.",
        speaker_count=2,
    )

    assert unchanged["selectedLane"] == "qwen17"
    assert overlap["selectedLane"] == "qwen17"
    assert "moss_multiple_speakers" in overlap["riskReasons"]


def test_preserves_numeric_and_latin_surfaces() -> None:
    surfaces = protected_surfaces("API v2 costs 18.5% and ATM 300元")
    assert {"18.5%", "300元", "api", "atm", "v2"} <= set(surfaces)
    decision = gate_revision(
        draft_text="API API v2 costs 18.5%.",
        revision_text="API costs 19.5%.",
        speaker_count=1,
    )
    assert decision["selectedLane"] == "qwen17"
