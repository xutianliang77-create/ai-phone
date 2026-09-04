def resolve_model_device(device: str) -> str:
    if device == "cpu":
        return "cpu"
    if device not in ("auto", "cuda"):
        raise ValueError(f"Unsupported speaker device: {device}")
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if device == "cuda":
        raise RuntimeError("SPEAKER_DEVICE=cuda requires an available CUDA device")
    return "cpu"
