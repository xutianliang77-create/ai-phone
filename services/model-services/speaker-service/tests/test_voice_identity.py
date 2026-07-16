import pytest

from app.voice_identity import require_local_checkpoint


def test_nemo_voice_identity_requires_a_local_checkpoint(tmp_path) -> None:
    checkpoint = tmp_path / "missing.nemo"

    with pytest.raises(FileNotFoundError, match="checkpoint is missing"):
        require_local_checkpoint(str(checkpoint))


def test_nemo_voice_identity_accepts_an_existing_local_checkpoint(tmp_path) -> None:
    checkpoint = tmp_path / "titanet.nemo"
    checkpoint.write_bytes(b"checkpoint")

    assert require_local_checkpoint(str(checkpoint)) == checkpoint
